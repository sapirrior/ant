import { Command } from 'commander'
import { acquireLease, openDb, releaseLease } from '../store/db.ts'
import { getThread, resolveThreadId } from '../store/threads.ts'
import {
  getCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  type CheckpointRecord,
} from '../store/checkpoints.ts'

function formatTimeAgo(timestampMs: number): string {
  const diffSec = Math.floor((Date.now() - timestampMs) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDays = Math.floor(diffHour / 24)
  return `${diffDays}d ago`
}

function renderCheckpointsList(threadId: string, threadTitle: string, checkpoints: readonly CheckpointRecord[]): string {
  if (checkpoints.length === 0) {
    return `Thread ${threadId} — ${threadTitle}\nNo checkpoints recorded for this thread.\n`
  }

  let out = `Thread ${threadId} — ${threadTitle}\n`
  out += '  #  WHEN     TOOL        FILES\n'

  for (const cp of checkpoints) {
    const when = formatTimeAgo(cp.createdAt).padEnd(8)
    const tool = cp.tool.padEnd(11)
    const filesSummary = cp.files
      .map((f) => `${f.status ?? '~'} ${f.path}`)
      .join(', ')

    out += `  ${String(cp.seq).padEnd(2)} ${when} ${tool} ${filesSummary}\n`
  }
  return out
}

export function registerCheckpointsCommand(program: Command): void {
  const checkpoints = program.command('checkpoints').description('Manage file snapshots and rewinds')

  checkpoints
    .command('list', { isDefault: true })
    .description('List checkpoints for a thread')
    .option('--thread <id|latest>', 'Thread ID or "latest"', 'latest')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const db = openDb()
      try {
        const threadId = resolveThreadId(db, options.thread, process.cwd())
        const thread = getThread(db, threadId, process.cwd())
        const records = listCheckpoints(db, thread.id)

        if (options.json) {
          const jsonOut = {
            threadId: thread.id,
            threadTitle: thread.title,
            checkpoints: records.map((cp) => ({
              ...cp,
              createdAt: new Date(cp.createdAt).toISOString(),
            })),
          }
          process.stdout.write(JSON.stringify(jsonOut, null, 2) + '\n')
        } else {
          process.stdout.write(renderCheckpointsList(thread.id, thread.title, records))
        }
      } catch (err) {
        process.stderr.write(`[ant] error: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exitCode = 1
      } finally {
        db.close()
      }
    })

  checkpoints
    .command('show <seq>')
    .description('Show details of a specific checkpoint sequence number')
    .option('--thread <id|latest>', 'Thread ID or "latest"', 'latest')
    .option('--json', 'Output as JSON')
    .action((seqStr: string, options) => {
      const db = openDb()
      try {
        const seq = Number.parseInt(seqStr, 10)
        if (Number.isNaN(seq) || seq <= 0) {
          throw new Error(`Invalid checkpoint sequence number: "${seqStr}". Must be a positive integer.`)
        }

        const threadId = resolveThreadId(db, options.thread, process.cwd())
        const thread = getThread(db, threadId, process.cwd())
        const cp = getCheckpoint(db, thread.id, seq)

        if (options.json) {
          const jsonOut = {
            ...cp,
            createdAt: new Date(cp.createdAt).toISOString(),
          }
          process.stdout.write(JSON.stringify(jsonOut, null, 2) + '\n')
          return
        }

        let out = `Checkpoint #${cp.seq} (Thread ${thread.id})\n`
        out += `Created:   ${new Date(cp.createdAt).toISOString()} (${formatTimeAgo(cp.createdAt)})\n`
        out += `Tool:      ${cp.tool}\n`
        if (cp.toolCallId) out += `Tool Call: ${cp.toolCallId}\n`
        out += 'Files:\n'

        for (const f of cp.files) {
          const status = f.status ?? '~'
          const before = f.beforeHash ? f.beforeHash.slice(0, 10) : '<none>'
          const after = f.afterHash ? f.afterHash.slice(0, 10) : '<deleted>'
          out += `  ${status} ${f.path} (${before} → ${after})\n`
        }

        process.stdout.write(out)
      } catch (err) {
        process.stderr.write(`[ant] error: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exitCode = 1
      } finally {
        db.close()
      }
    })

  checkpoints
    .command('restore <seq>')
    .description('Rewind workspace files to just before checkpoint sequence number')
    .option('--thread <id|latest>', 'Thread ID or "latest"', 'latest')
    .option('--dry-run', 'Preview restoration plan without modifying files')
    .option('--force', 'Overwrite conflicts from external file changes')
    .action((seqStr: string, options) => {
      const db = openDb()
      try {
        const seq = Number.parseInt(seqStr, 10)
        if (Number.isNaN(seq) || seq <= 0) {
          throw new Error(`Invalid checkpoint sequence number: "${seqStr}". Must be a positive integer.`)
        }

        const threadId = resolveThreadId(db, options.thread, process.cwd())
        const thread = getThread(db, threadId, process.cwd())

        if (thread.cwd !== process.cwd()) {
          throw new Error(`thread belongs to ${thread.cwd}; cd there first`)
        }

        // Acquire lease during restoration
        acquireLease(db, thread.id)
        try {
          const res = restoreCheckpoint(db, thread.id, seq, {
            cwd: thread.cwd,
            dryRun: Boolean(options.dryRun),
            force: Boolean(options.force),
          })

          if (res.dryRun) {
            process.stdout.write(`Dry run: restoration plan for checkpoint #${seq} (Thread ${thread.id}):\n`)
            for (const item of res.plan) {
              const statusStr = item.isConflict ? ' [CONFLICT]' : ''
              process.stdout.write(`  ${item.action.toUpperCase()} ${item.path}${statusStr}\n`)
            }
          } else {
            process.stdout.write(
              `[ant] restored workspace to before checkpoint #${seq} (new checkpoint #${res.restoredSeq} created)\n`
            )
            for (const item of res.plan) {
              process.stdout.write(`  ${item.action.toUpperCase()} ${item.path}\n`)
            }
          }
        } finally {
          releaseLease(db, thread.id)
        }
      } catch (err) {
        process.stderr.write(`[ant] error: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exitCode = 1
      } finally {
        db.close()
      }
    })
}
