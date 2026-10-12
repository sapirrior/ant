import type { Database } from 'bun:sqlite'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite, snapshot, type FileSnapshot } from '../tools/fs.ts'

export interface CheckpointFileRecord {
  path: string // cwd-relative POSIX
  beforeHash: string | null
  afterHash: string | null
  mode?: number | null
  status?: '+' | '~' | '-'
}

export interface CheckpointRecord {
  id: number
  threadId: string
  seq: number
  createdAt: number
  tool: string
  toolCallId: string | null
  files: CheckpointFileRecord[]
}

export interface CheckpointInputFile {
  path: string
  before: FileSnapshot | null
  after: FileSnapshot | null
}

export function computeFileStatus(beforeHash: string | null, afterHash: string | null): '+' | '~' | '-' {
  if (beforeHash === null && afterHash !== null) return '+'
  if (beforeHash !== null && afterHash === null) return '-'
  return '~'
}

export function recordCheckpoint(
  db: Database,
  threadId: string,
  tool: string,
  toolCallId: string | undefined,
  files: CheckpointInputFile[]
): number {
  if (files.length === 0) {
    return 0
  }

  let assignedSeq = 0
  db.transaction(() => {
    // 1. Insert blobs idempotently inside the transaction
    for (const f of files) {
      if (f.before) {
        db.run('INSERT OR IGNORE INTO blobs (hash, size, data) VALUES (?, ?, ?)', [
          f.before.hash,
          f.before.size,
          f.before.data,
        ])
      }
      if (f.after) {
        db.run('INSERT OR IGNORE INTO blobs (hash, size, data) VALUES (?, ?, ?)', [
          f.after.hash,
          f.after.size,
          f.after.data,
        ])
      }
    }

    // 2. Insert checkpoint and checkpoint_files
    const seqRow = db
      .query('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM checkpoints WHERE thread_id = ?')
      .get(threadId) as { max_seq: number }
    assignedSeq = seqRow.max_seq + 1

    db.run(
      'INSERT INTO checkpoints (thread_id, seq, created_at, tool, tool_call_id) VALUES (?, ?, ?, ?, ?)',
      [threadId, assignedSeq, Date.now(), tool, toolCallId ?? null]
    )

    const cpId = (db.query('SELECT last_insert_rowid() AS id').get() as { id: number }).id

    for (const f of files) {
      db.run(
        'INSERT INTO checkpoint_files (checkpoint_id, path, before_hash, after_hash, mode) VALUES (?, ?, ?, ?, ?)',
        [
          cpId,
          f.path,
          f.before?.hash ?? null,
          f.after?.hash ?? null,
          f.after?.mode ?? f.before?.mode ?? null,
        ]
      )
    }
  })()

  return assignedSeq
}

export function listCheckpoints(db: Database, threadId: string): CheckpointRecord[] {
  const cpRows = db
    .query('SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY seq ASC')
    .all(threadId) as {
    id: number
    thread_id: string
    seq: number
    created_at: number
    tool: string
    tool_call_id: string | null
  }[]

  return cpRows.map((cp) => {
    const fileRows = db
      .query('SELECT path, before_hash, after_hash, mode FROM checkpoint_files WHERE checkpoint_id = ? ORDER BY path ASC')
      .all(cp.id) as {
      path: string
      before_hash: string | null
      after_hash: string | null
      mode: number | null
    }[]

    const files: CheckpointFileRecord[] = fileRows.map((f) => ({
      path: f.path,
      beforeHash: f.before_hash,
      afterHash: f.after_hash,
      mode: f.mode,
      status: computeFileStatus(f.before_hash, f.after_hash),
    }))

    return {
      id: cp.id,
      threadId: cp.thread_id,
      seq: cp.seq,
      createdAt: cp.created_at,
      tool: cp.tool,
      toolCallId: cp.tool_call_id,
      files,
    }
  })
}

export function getCheckpoint(db: Database, threadId: string, seq: number): CheckpointRecord {
  const cp = db
    .query('SELECT * FROM checkpoints WHERE thread_id = ? AND seq = ?')
    .get(threadId, seq) as {
    id: number
    thread_id: string
    seq: number
    created_at: number
    tool: string
    tool_call_id: string | null
  } | null

  if (!cp) {
    throw new Error(`Checkpoint #${seq} does not exist for thread "${threadId}"`)
  }

  const fileRows = db
    .query('SELECT path, before_hash, after_hash, mode FROM checkpoint_files WHERE checkpoint_id = ? ORDER BY path ASC')
    .all(cp.id) as {
    path: string
    before_hash: string | null
    after_hash: string | null
    mode: number | null
  }[]

  const files: CheckpointFileRecord[] = fileRows.map((f) => ({
    path: f.path,
    beforeHash: f.before_hash,
    afterHash: f.after_hash,
    mode: f.mode,
    status: computeFileStatus(f.before_hash, f.after_hash),
  }))

  return {
    id: cp.id,
    threadId: cp.thread_id,
    seq: cp.seq,
    createdAt: cp.created_at,
    tool: cp.tool,
    toolCallId: cp.tool_call_id,
    files,
  }
}

export interface RestorePlanItem {
  path: string
  action: 'restore' | 'delete'
  targetHash: string | null
  expectedHash: string | null
  currentHash: string | null
  isConflict: boolean
}

export interface RestoreResult {
  restoredSeq: number
  plan: RestorePlanItem[]
  dryRun: boolean
}

export function restoreCheckpoint(
  db: Database,
  threadId: string,
  targetSeq: number,
  options: {
    cwd: string
    dryRun?: boolean
    force?: boolean
  }
): RestoreResult {
  // 1. Verify checkpoint exists
  getCheckpoint(db, threadId, targetSeq)

  // 2. Collect all checkpoint files touched by seq >= targetSeq
  const rows = db
    .query(
      `
      SELECT c.seq, cf.path, cf.before_hash, cf.after_hash, cf.mode
      FROM checkpoints c
      JOIN checkpoint_files cf ON c.id = cf.checkpoint_id
      WHERE c.thread_id = ? AND c.seq >= ?
      ORDER BY c.seq ASC
      `
    )
    .all(threadId, targetSeq) as {
    seq: number
    path: string
    before_hash: string | null
    after_hash: string | null
    mode: number | null
  }[]

  // Group by path
  const pathsMap = new Map<
    string,
    {
      lowestBeforeHash: string | null
      lowestMode: number | null
      highestAfterHash: string | null
    }
  >()

  for (const r of rows) {
    if (!pathsMap.has(r.path)) {
      pathsMap.set(r.path, {
        lowestBeforeHash: r.before_hash,
        lowestMode: r.mode,
        highestAfterHash: r.after_hash,
      })
    } else {
      const entry = pathsMap.get(r.path)!
      entry.highestAfterHash = r.after_hash
    }
  }

  // 3. Inspect disk state & CAS #2 conflict detection
  const plan: RestorePlanItem[] = []
  const conflicts: RestorePlanItem[] = []

  for (const [relPath, entry] of pathsMap.entries()) {
    const absPath = join(options.cwd, relPath)
    const diskSnap = snapshot(absPath)
    const currentHash = diskSnap ? diskSnap.hash : null
    const expectedHash = entry.highestAfterHash
    const targetHash = entry.lowestBeforeHash

    const isConflict = currentHash !== expectedHash
    const action: 'restore' | 'delete' = targetHash === null ? 'delete' : 'restore'

    const item: RestorePlanItem = {
      path: relPath,
      action,
      targetHash,
      expectedHash,
      currentHash,
      isConflict,
    }

    plan.push(item)
    if (isConflict) {
      conflicts.push(item)
    }
  }

  // 4. Abort on conflicts without --force
  if (conflicts.length > 0 && !options.force) {
    const conflictLines = conflicts
      .map(
        (c) =>
          `  ${c.path} (expected ${c.expectedHash?.slice(0, 8) ?? 'absent'}, current on disk ${c.currentHash?.slice(0, 8) ?? 'absent'})`
      )
      .join('\n')
    throw new Error(
      `Cannot restore to checkpoint #${targetSeq}: conflicting modifications detected outside ant on:\n${conflictLines}\nUse --force to overwrite external modifications.`
    )
  }

  // 5. Dry run
  if (options.dryRun) {
    return {
      restoredSeq: 0,
      plan,
      dryRun: true,
    }
  }

  // 6. Apply restoration to disk and capture snapshots for restore checkpoint
  const restoreCheckpointFiles: CheckpointInputFile[] = []

  for (const item of plan) {
    const absPath = join(options.cwd, item.path)
    const beforeSnap = snapshot(absPath)

    if (item.action === 'delete') {
      if (existsSync(absPath)) {
        unlinkSync(absPath)
      }
      restoreCheckpointFiles.push({
        path: item.path,
        before: beforeSnap,
        after: null,
      })
    } else {
      // Fetch blob
      const blobRow = db
        .query('SELECT data FROM blobs WHERE hash = ?')
        .get(item.targetHash!) as { data: Buffer } | null

      if (!blobRow) {
        throw new Error(`Corrupted blob store: blob with hash ${item.targetHash} not found`)
      }

      const mode = pathsMap.get(item.path)?.lowestMode ?? 0o644
      atomicWrite(absPath, blobRow.data, mode)
      const afterSnap = snapshot(absPath)

      restoreCheckpointFiles.push({
        path: item.path,
        before: beforeSnap,
        after: afterSnap,
      })
    }
  }

  // 7. Record restore checkpoint so the restoration itself can be undone
  const newSeq = recordCheckpoint(db, threadId, 'restore', undefined, restoreCheckpointFiles)

  return {
    restoredSeq: newSeq,
    plan,
    dryRun: false,
  }
}
