import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function getAntHome(): string {
  return process.env.ANT_HOME ?? join(homedir(), '.ant')
}

export function getDbPath(): string {
  return join(getAntHome(), 'ant.db')
}

export const MIGRATIONS: readonly string[] = [
  // Migration 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS threads (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    cwd           TEXT NOT NULL,
    model         TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    turns         INTEGER NOT NULL DEFAULT 0,
    messages      INTEGER NOT NULL DEFAULT 0,
    steps         INTEGER NOT NULL DEFAULT 0,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    lock_pid      INTEGER,
    lock_at       INTEGER
  );
  CREATE INDEX IF NOT EXISTS threads_cwd_updated ON threads(cwd, updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    seq       INTEGER NOT NULL,
    json      TEXT NOT NULL,
    PRIMARY KEY (thread_id, seq)
  );

  CREATE TABLE IF NOT EXISTS blobs (
    hash TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    data BLOB NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkpoints (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id    TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    tool         TEXT NOT NULL,
    tool_call_id TEXT,
    UNIQUE (thread_id, seq)
  );

  CREATE TABLE IF NOT EXISTS checkpoint_files (
    checkpoint_id INTEGER NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
    path          TEXT NOT NULL,
    before_hash   TEXT,
    after_hash    TEXT,
    mode          INTEGER,
    PRIMARY KEY (checkpoint_id, path)
  );
  `,
  // Migration 2: Track last run status and exit code
  `
  ALTER TABLE threads ADD COLUMN last_status TEXT;
  ALTER TABLE threads ADD COLUMN last_exit_code INTEGER;
  `,
]

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code: string }).code
      return code === 'EPERM'
    }
    return false
  }
}

export function openDb(customPath?: string): Database {
  const dbPath = customPath ?? getDbPath()
  const dir = dirname(dbPath)

  mkdirSync(dir, { recursive: true, mode: 0o700 })

  if (!existsSync(dbPath)) {
    try {
      const fd = openSync(dbPath, 'wx', 0o600)
      closeSync(fd)
    } catch {
      // ignore EEXIST race
    }
  }

  const db = new Database(dbPath)

  // Configure Pragmas on every open
  db.run('PRAGMA journal_mode = WAL;')
  db.run('PRAGMA busy_timeout = 5000;')
  db.run('PRAGMA foreign_keys = ON;')
  db.run('PRAGMA synchronous = NORMAL;')

  // Migration management inside immediate transaction
  db.transaction(() => {
    const row = db.query('PRAGMA user_version;').get() as { user_version: number }
    const currentVersion = row ? row.user_version : 0

    if (currentVersion > MIGRATIONS.length) {
      throw new Error('database was created by a newer ant')
    }

    for (let v = currentVersion; v < MIGRATIONS.length; v++) {
      const sql = MIGRATIONS[v]!
      const nextVersion = v + 1
      db.exec(sql)
      db.run(`PRAGMA user_version = ${nextVersion};`)
    }
  }).immediate()

  return db
}

export function acquireLease(db: Database, threadId: string): void {
  db.transaction(() => {
    const row = db
      .query('SELECT lock_pid, lock_at FROM threads WHERE id = ?')
      .get(threadId) as { lock_pid: number | null; lock_at: number | null } | null

    if (!row) {
      throw new Error(`Thread not found: "${threadId}"`)
    }

    if (row.lock_pid !== null) {
      if (row.lock_pid === process.pid) {
        return
      }
      if (pidAlive(row.lock_pid)) {
        const timeStr = row.lock_at ? new Date(row.lock_at).toISOString() : 'unknown time'
        throw new Error(`thread ${threadId} is in use by pid ${row.lock_pid} since ${timeStr}`)
      }
      // Process is dead, lease can be taken over
    }

    db.run('UPDATE threads SET lock_pid = ?, lock_at = ? WHERE id = ?', [
      process.pid,
      Date.now(),
      threadId,
    ])
  })()
}

export function releaseLease(db: Database, threadId: string): void {
  db.run('UPDATE threads SET lock_pid = NULL, lock_at = NULL WHERE id = ? AND lock_pid = ?', [
    threadId,
    process.pid,
  ])
}
