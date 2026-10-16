import { Command } from 'commander'
import { openDb } from '../store/db.ts'
import {
  deleteThread,
  getMessages,
  getThread,
  listThreads,
  renameThread,
  type ThreadRecord,
} from '../store/threads.ts'
import { createInterface } from 'node:readline/promises'
import {
  formatTimeAgo,
  formatTokens,
  padEndVisible,
  padStartVisible,
  visibleWidth,
} from '../utils/format.ts'
import { parseIntStrict } from '../utils/number.ts'
import { pidAlive } from '../utils/process.ts'
import { displayPath } from '../output/paths.ts'
import { notice } from '../output/notice.ts'

function renderTable(threads: readonly ThreadRecord[], showCwd: boolean): string {
  if (threads.length === 0) {
    return 'No threads found.\n'
  }

  const rows = threads.map((t) => {
    const isLocked = t.lockPid !== null && pidAlive(t.lockPid)
    const idDisplay = (isLocked ? '● ' : '  ') + t.id
    const updated = formatTimeAgo(t.updatedAt)
    const turns = String(t.turns)
    const msgs = String(t.messages)
    const ckpts = String(t.checkpointCount ?? 0)
    const tokens = `${formatTokens(t.inputTokens)} / ${formatTokens(t.outputTokens)}`
    const title = t.title
    const cwd = displayPath(t.cwd)
    return { idDisplay, updated, turns, msgs, ckpts, tokens, title, cwd }
  })

  // Calculate column widths
  let wId = visibleWidth('ID')
  let wUp = visibleWidth('UPDATED')
  let wTu = visibleWidth('TURNS')
  let wMs = visibleWidth('MSGS')
  let wCk = visibleWidth('CKPTS')
  let wTk = visibleWidth('TOKENS (in/out)')
  let wCwd = visibleWidth('CWD')

  for (const r of rows) {
    if (visibleWidth(r.idDisplay) > wId) wId = visibleWidth(r.idDisplay)
    if (visibleWidth(r.updated) > wUp) wUp = visibleWidth(r.updated)
    if (visibleWidth(r.turns) > wTu) wTu = visibleWidth(r.turns)
    if (visibleWidth(r.msgs) > wMs) wMs = visibleWidth(r.msgs)
    if (visibleWidth(r.ckpts) > wCk) wCk = visibleWidth(r.ckpts)
    if (visibleWidth(r.tokens) > wTk) wTk = visibleWidth(r.tokens)
    if (visibleWidth(r.cwd) > wCwd) wCwd = visibleWidth(r.cwd)
  }

  const colHeader = showCwd ? `${padEndVisible('CWD', wCwd)}  ` : ''
  let out = `${padEndVisible('ID', wId)}  ${padEndVisible('UPDATED', wUp)}  ${padStartVisible('TURNS', wTu)}  ${padStartVisible('MSGS', wMs)}  ${padStartVisible('CKPTS', wCk)}  ${padEndVisible('TOKENS (in/out)', wTk)}  ${colHeader}TITLE\n`
  for (const r of rows) {
    const colVal = showCwd ? `${padEndVisible(r.cwd, wCwd)}  ` : ''
    out += `${padEndVisible(r.idDisplay, wId)}  ${padEndVisible(r.updated, wUp)}  ${padStartVisible(r.turns, wTu)}  ${padStartVisible(r.msgs, wMs)}  ${padStartVisible(r.ckpts, wCk)}  ${padEndVisible(r.tokens, wTk)}  ${colVal}${r.title}\n`
  }
  return out
}

export function registerThreadsCommand(program: Command): void {
  const threads = program.command('threads').description('Manage conversation threads')

  threads
    .command('list', { isDefault: true })
    .description('List conversation threads')
    .option('-a, --all', 'Show threads across all directories and include CWD column')
    .option('-n, --limit <number>', 'Number of threads to list', '20')
    .option('-j, --json', 'Output as JSON')
    .action((options) => {
      const db = openDb()
      try {
        const limit = parseIntStrict('limit', options.limit, { min: 1 })
        const records = listThreads(db, {
          cwd: process.cwd(),
          all: Boolean(options.all),
          limit,
        })

        if (options.json) {
          const jsonOut = records.map((t) => ({
            ...t,
            createdAt: new Date(t.createdAt).toISOString(),
            updatedAt: new Date(t.updatedAt).toISOString(),
            isLocked: t.lockPid !== null && pidAlive(t.lockPid),
          }))
          process.stdout.write(JSON.stringify(jsonOut, null, 2) + '\n')
        } else {
          process.stdout.write(renderTable(records, Boolean(options.all)))
        }
      } catch (err) {
        notice.error(err instanceof Error ? err.message : String(err))
        process.exitCode = 1
      } finally {
        db.close()
      }
    })

  threads
    .command('show <id>')
    .description('Show details and transcript for a thread ("<id>" or "latest")')
    .option('-m, --messages', 'Display message transcript')
    .option('-j, --json', 'Output as JSON')
    .action((idOrPrefix: string, options) => {
      const db = openDb()
      try {
        const thread = getThread(db, idOrPrefix, process.cwd())
        const messages = options.messages || options.json ? getMessages(db, thread.id) : []

        if (options.json) {
          const jsonOut = {
            ...thread,
            createdAt: new Date(thread.createdAt).toISOString(),
            updatedAt: new Date(thread.updatedAt).toISOString(),
            isLocked: thread.lockPid !== null && pidAlive(thread.lockPid),
            ...(options.messages ? { messages } : {}),
          }
          process.stdout.write(JSON.stringify(jsonOut, null, 2) + '\n')
          return
        }

        const isLocked = thread.lockPid !== null && pidAlive(thread.lockPid)
        let leaseStatus = 'none'
        if (isLocked) {
          const lockTime = thread.lockAt ? new Date(thread.lockAt).toISOString() : 'unknown'
          leaseStatus = `held by pid ${thread.lockPid} since ${lockTime}`
        }

        let out = `ID:           ${thread.id}\n`
        out += `Title:        ${thread.title}\n`
        out += `CWD:          ${thread.cwd}\n`
        out += `Model:        ${thread.model}\n`
        out += `Created:      ${new Date(thread.createdAt).toISOString()}\n`
        out += `Updated:      ${new Date(thread.updatedAt).toISOString()} (${formatTimeAgo(thread.updatedAt)})\n`
        out += `Turns:        ${thread.turns}\n`
        out += `Messages:     ${thread.messages}\n`
        out += `Steps:        ${thread.steps}\n`
        out += `Checkpoints:  ${thread.checkpointCount ?? 0}\n`
        out += `Tokens:       ${thread.inputTokens} in / ${thread.outputTokens} out\n`
        out += `Lease:        ${leaseStatus}\n`

        if (options.messages) {
          out += '\n--- Transcript ---\n'
          for (const msg of messages) {
            out += `\n[${msg.role}]\n`
            if (typeof msg.content === 'string') {
              out += `${msg.content}\n`
            } else if (Array.isArray(msg.content)) {
              for (const part of msg.content) {
                if (part.type === 'text') {
                  out += `${part.text}\n`
                } else if (part.type === 'tool-call') {
                  out += `→ ${part.toolName} ${JSON.stringify(part.input)}\n`
                } else if (part.type === 'tool-result') {
                  out += `← ${part.toolName} result\n`
                }
              }
            }
          }
        }

        process.stdout.write(out)
      } catch (err) {
        notice.error(err instanceof Error ? err.message : String(err))
        process.exitCode = 1
      } finally {
        db.close()
      }
    })

  threads
    .command('rename <id> <title...>')
    .description('Rename a thread')
    .action((idOrPrefix: string, titleParts: string[]) => {
      const db = openDb()
      try {
        const fullTitle = titleParts.join(' ')
        const updated = renameThread(db, idOrPrefix, fullTitle, process.cwd())
        notice.info(`renamed thread ${updated.id} to "${updated.title}"`)
      } catch (err) {
        notice.error(err instanceof Error ? err.message : String(err))
        process.exitCode = 1
      } finally {
        db.close()
      }
    })

  threads
    .command('delete <id>')
    .description('Delete a thread')
    .option('-y, --yes', 'Confirm deletion without prompting')
    .action(async (idOrPrefix: string, options) => {
      const db = openDb()
      try {
        const thread = getThread(db, idOrPrefix, process.cwd())

        if (!options.yes) {
          if (!process.stdin.isTTY) {
            notice.error('deletion requires confirmation (-y)')
            process.exitCode = 2
            return
          }

          const rl = createInterface({ input: process.stdin, output: process.stdout })
          try {
            const answer = await rl.question(
              `Delete thread ${thread.id} ("${thread.title}")? [y/N] `,
            )
            if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
              process.stdout.write('Aborted.\n')
              return
            }
          } finally {
            rl.close()
          }
        }

        deleteThread(db, thread.id, process.cwd())
        notice.info(`deleted thread ${thread.id}`)
      } catch (err) {
        notice.error(err instanceof Error ? err.message : String(err))
        process.exitCode = 1
      } finally {
        db.close()
      }
    })
}
