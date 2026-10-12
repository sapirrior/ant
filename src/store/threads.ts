import type { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import type { ModelMessage } from 'ai'
import type { UsageSummary } from '../core/types.ts'
import { pidAlive } from './db.ts'

export interface ThreadRecord {
  id: string
  title: string
  cwd: string
  model: string
  createdAt: number
  updatedAt: number
  turns: number
  messages: number
  steps: number
  inputTokens: number
  outputTokens: number
  lockPid: number | null
  lockAt: number | null
  checkpointCount?: number
}

interface ThreadRow {
  id: string
  title: string
  cwd: string
  model: string
  created_at: number
  updated_at: number
  turns: number
  messages: number
  steps: number
  input_tokens: number
  output_tokens: number
  lock_pid: number | null
  lock_at: number | null
  checkpoint_count?: number
}

function mapRow(row: ThreadRow): ThreadRecord {
  return {
    id: row.id,
    title: row.title,
    cwd: row.cwd,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    turns: row.turns,
    messages: row.messages,
    steps: row.steps,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    lockPid: row.lock_pid,
    lockAt: row.lock_at,
    checkpointCount: row.checkpoint_count,
  }
}

export function generateThreadId(): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const random = randomBytes(4).toString('hex')
  return `th_${timestamp}_${random}`
}

export function formatTitle(input: string): string {
  const collapsed = input.trim().replace(/\s+/g, ' ')
  if (collapsed.length <= 80) return collapsed
  return collapsed.slice(0, 79) + '…'
}

export function createThread(
  db: Database,
  options: {
    prompt?: string
    stdinInput?: string
    cwd: string
    model: string
  }
): ThreadRecord {
  const id = generateThreadId()
  const now = Date.now()

  let rawTitle = options.prompt
  if (!rawTitle && options.stdinInput) {
    const firstLine = options.stdinInput.split('\n').map((l) => l.trim()).find(Boolean)
    if (firstLine) rawTitle = firstLine
  }
  const title = formatTitle(rawTitle || 'New thread')

  let realCwd = options.cwd
  try {
    realCwd = realpathSync(options.cwd)
  } catch {
    // fallback if directory does not exist or cannot be resolved
  }

  db.run(
    `
    INSERT INTO threads (
      id, title, cwd, model, created_at, updated_at,
      turns, messages, steps, input_tokens, output_tokens, lock_pid, lock_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, NULL, NULL)
    `,
    [id, title, realCwd, options.model, now, now]
  )

  const created = getThread(db, id)
  return created
}

export function resolveThreadId(db: Database, idOrPrefix: string, cwd?: string): string {
  if (idOrPrefix === 'latest') {
    let targetCwd = cwd ?? process.cwd()
    try {
      targetCwd = realpathSync(targetCwd)
    } catch {
      // fallback
    }

    const row = db
      .query('SELECT id FROM threads WHERE cwd = ? ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1')
      .get(targetCwd) as { id: string } | null

    if (!row) {
      throw new Error(`No threads found for cwd "${targetCwd}"`)
    }
    return row.id
  }

  // Exact match
  const exact = db.query('SELECT id FROM threads WHERE id = ?').get(idOrPrefix) as { id: string } | null
  if (exact) {
    return exact.id
  }

  // Prefix match
  const candidates = db
    .query('SELECT id FROM threads WHERE id LIKE ? ORDER BY updated_at DESC')
    .all(`${idOrPrefix}%`) as { id: string }[]

  if (candidates.length === 0) {
    throw new Error(`Thread not found: "${idOrPrefix}"`)
  }
  if (candidates.length > 1) {
    const list = candidates.map((c) => c.id).join(', ')
    throw new Error(`Ambiguous thread ID prefix "${idOrPrefix}". Matches: ${list}`)
  }

  return candidates[0]!.id
}

export function getThread(db: Database, idOrPrefix: string, cwd?: string): ThreadRecord {
  const id = resolveThreadId(db, idOrPrefix, cwd)
  const row = db
    .query(
      `
      SELECT t.*,
        (SELECT COUNT(*) FROM checkpoints c WHERE c.thread_id = t.id) AS checkpoint_count
      FROM threads t
      WHERE t.id = ?
      `
    )
    .get(id) as ThreadRow | null

  if (!row) {
    throw new Error(`Thread not found: "${id}"`)
  }
  return mapRow(row)
}

export function listThreads(
  db: Database,
  options: {
    cwd?: string
    all?: boolean
    limit?: number
  } = {}
): ThreadRecord[] {
  const limit = options.limit ?? 20
  let rows: ThreadRow[]

  if (options.all) {
    rows = db
      .query(
        `
        SELECT t.*,
          (SELECT COUNT(*) FROM checkpoints c WHERE c.thread_id = t.id) AS checkpoint_count
        FROM threads t
        ORDER BY t.updated_at DESC
        LIMIT ?
        `
      )
      .all(limit) as ThreadRow[]
  } else {
    let targetCwd = options.cwd ?? process.cwd()
    try {
      targetCwd = realpathSync(targetCwd)
    } catch {
      // fallback
    }

    rows = db
      .query(
        `
        SELECT t.*,
          (SELECT COUNT(*) FROM checkpoints c WHERE c.thread_id = t.id) AS checkpoint_count
        FROM threads t
        WHERE t.cwd = ?
        ORDER BY t.updated_at DESC
        LIMIT ?
        `
      )
      .all(targetCwd, limit) as ThreadRow[]
  }

  return rows.map(mapRow)
}

export function renameThread(db: Database, idOrPrefix: string, newTitle: string, cwd?: string): ThreadRecord {
  const id = resolveThreadId(db, idOrPrefix, cwd)
  const cleaned = newTitle.trim().replace(/\s+/g, ' ')
  if (cleaned.length === 0 || cleaned.length > 120) {
    throw new Error(`Invalid title length (${cleaned.length} characters). Must be between 1 and 120 characters.`)
  }

  db.run('UPDATE threads SET title = ?, updated_at = ? WHERE id = ?', [cleaned, Date.now(), id])
  return getThread(db, id)
}

export function deleteThread(db: Database, idOrPrefix: string, cwd?: string): void {
  const id = resolveThreadId(db, idOrPrefix, cwd)

  const row = db
    .query('SELECT lock_pid FROM threads WHERE id = ?')
    .get(id) as { lock_pid: number | null } | null

  if (row?.lock_pid !== null && row?.lock_pid !== undefined && pidAlive(row.lock_pid)) {
    throw new Error(`Cannot delete thread ${id}: active lease held by pid ${row.lock_pid}`)
  }

  db.transaction(() => {
    db.run('DELETE FROM threads WHERE id = ?', [id])
    // Clean unreferenced blobs (Blob GC §4.2)
    db.run(
      `
      DELETE FROM blobs
      WHERE hash NOT IN (
        SELECT before_hash FROM checkpoint_files WHERE before_hash IS NOT NULL
        UNION
        SELECT after_hash FROM checkpoint_files WHERE after_hash IS NOT NULL
      )
      `
    )
  })()
}

export function appendMessage(db: Database, threadId: string, message: ModelMessage): void {
  const jsonStr = JSON.stringify(message)
  const isUser = message.role === 'user'

  db.transaction(() => {
    const seqRow = db
      .query('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM messages WHERE thread_id = ?')
      .get(threadId) as { max_seq: number }
    const nextSeq = seqRow.max_seq + 1

    db.run('INSERT INTO messages (thread_id, seq, json) VALUES (?, ?, ?)', [
      threadId,
      nextSeq,
      jsonStr,
    ])

    db.run(
      `
      UPDATE threads
      SET messages = messages + 1,
          turns = turns + ?,
          updated_at = ?
      WHERE id = ?
      `,
      [isUser ? 1 : 0, Date.now(), threadId]
    )
  })()
}

export function getMessages(db: Database, threadId: string): ModelMessage[] {
  const rows = db
    .query('SELECT json FROM messages WHERE thread_id = ? ORDER BY seq ASC')
    .all(threadId) as { json: string }[]

  return rows.map((r) => JSON.parse(r.json) as ModelMessage)
}

export function recordStepMessages(
  db: Database,
  threadId: string,
  messages: readonly ModelMessage[],
  stepsIncrement: number,
  usage?: UsageSummary
): void {
  if (messages.length === 0 && stepsIncrement === 0) return

  db.transaction(() => {
    let nextSeq = (
      db.query('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM messages WHERE thread_id = ?').get(threadId) as {
        max_seq: number
      }
    ).max_seq

    for (const msg of messages) {
      nextSeq++
      db.run('INSERT INTO messages (thread_id, seq, json) VALUES (?, ?, ?)', [
        threadId,
        nextSeq,
        JSON.stringify(msg),
      ])
    }

    db.run(
      `
      UPDATE threads
      SET messages = messages + ?,
          steps = steps + ?,
          input_tokens = input_tokens + ?,
          output_tokens = output_tokens + ?,
          updated_at = ?
      WHERE id = ?
      `,
      [
        messages.length,
        stepsIncrement,
        usage?.inputTokens ?? 0,
        usage?.outputTokens ?? 0,
        Date.now(),
        threadId,
      ]
    )
  })()
}
