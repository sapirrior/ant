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
import { pidAlive } from '../store/db.ts'
import { createInterface } from 'node:readline/promises'

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

function formatTokens(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}m`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return `${count}`
}

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
    return { idDisplay, updated, turns, msgs, ckpts, tokens, title, cwd: t.cwd }
  })

  // Calculate column widths
  let wId = 'ID'.length
  let wUp = 'UPDATED'.length
  let wTu = 'TURNS'.length
  let wMs = 'MSGS'.length
  let wCk = 'CKPTS'.length
  let wTk = 'TOKENS (in/out)'.length
  let wCwd = 'CWD'.length

  for (const r of rows) {
    if (r.idDisplay.length > wId) wId = r.idDisplay.length
    if (r.updated.length > wUp) wUp = r.updated.length
    if (r.turns.length > wTu) wTu = r.turns.length
    if (r.msgs.length > wMs) wMs = r.msgs.length
    if (r.ckpts.length > wCk) wCk = r.ckpts.length
    if (r.tokens.length > wTk) wTk = r.tokens.length
    if (r.cwd.length > wCwd) wCwd = r.cwd.length
  }

  let out = ''
  if (showCwd) {
    out += `${'ID'.padEnd(wId)}  ${'UPDATED'.padEnd(wUp)}  ${'TURNS'.padStart(wTu)}  ${'MSGS'.padStart(wMs)}  ${'CKPTS'.padStart(wCk)}  ${'TOKENS (in/out)'.padEnd(wTk)}  ${'CWD'.padEnd(wCwd)}  TITLE\n`
    for (const r of rows) {
      out += `${r.idDisplay.padEnd(wId)}  ${r.updated.padEnd(wUp)}  ${r.turns.padStart(wTu)}  ${r.msgs.padStart(wMs)}  ${r.ckpts.padStart(wCk)}  ${r.tokens.padEnd(wTk)}  ${r.cwd.padEnd(wCwd)}  ${r.title}\n`
    }
  } else {
    out += `${'ID'.padEnd(wId)}  ${'UPDATED'.padEnd(wUp)}  ${'TURNS'.padStart(wTu)}  ${'MSGS'.padStart(wMs)}  ${'CKPTS'.padStart(wCk)}  ${'TOKENS (in/out)'.padEnd(wTk)}  TITLE\n`
    for (const r of rows) {
      out += `${r.idDisplay.padEnd(wId)}  ${r.updated.padEnd(wUp)}  ${r.turns.padStart(wTu)}  ${r.msgs.padStart(wMs)}  ${r.ckpts.padStart(wCk)}  ${r.tokens.padEnd(wTk)}  ${r.title}\n`
    }
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
        const limit = Number.parseInt(options.limit, 10)
        const records = listThreads(db, {
          cwd: process.cwd(),
          all: Boolean(options.all),
          limit: Number.isNaN(limit) ? 20 : limit,
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
        process.stderr.write(`[ant] error: ${err instanceof Error ? err.message : String(err)}\n`)
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
        process.stdout.write(`[ant] renamed thread ${updated.id} to "${updated.title}"\n`)
      } catch (err) {
        process.stderr.write(`[ant] error: ${err instanceof Error ? err.message : String(err)}\n`)
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
            process.stderr.write('[ant] error: deletion requires confirmation (-y)\n')
            process.exitCode = 2
            return
          }

          const rl = createInterface({ input: process.stdin, output: process.stdout })
          try {
            const answer = await rl.question(`Delete thread ${thread.id} ("${thread.title}")? [y/N] `)
            if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
              process.stdout.write('Aborted.\n')
              return
            }
          } finally {
            rl.close()
          }
        }

        deleteThread(db, thread.id, process.cwd())
        process.stdout.write(`[ant] deleted thread ${thread.id}\n`)
      } catch (err) {
        process.stderr.write(`[ant] error: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exitCode = 1
      } finally {
        db.close()
      }
    })
}
