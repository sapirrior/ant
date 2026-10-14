import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { acquireLease, getDbPath, openDb, pidAlive, releaseLease } from './db.ts'
import { createThread } from './threads.ts'

describe('database store', () => {
  let tempDir: string
  let origAntHome: string | undefined

  beforeEach(() => {
    origAntHome = process.env.ANT_HOME
    tempDir = mkdtempSync(join(tmpdir(), 'ant-db-test-'))
    process.env.ANT_HOME = tempDir
  })

  afterEach(() => {
    if (origAntHome !== undefined) {
      process.env.ANT_HOME = origAntHome
    } else {
      delete process.env.ANT_HOME
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates ant.db with proper directory and file modes, pragmas and migration', () => {
    const db = openDb()
    try {
      const dbPath = getDbPath()
      const dirStat = statSync(tempDir)
      const fileStat = statSync(dbPath)

      // Dir mode (0700) and file mode (0600)
      expect(dirStat.mode & 0o777).toBe(0o700)
      expect(fileStat.mode & 0o777).toBe(0o600)

      // Pragmas
      const journalMode = db.query('PRAGMA journal_mode;').get() as { journal_mode: string }
      expect(journalMode.journal_mode.toLowerCase()).toBe('wal')

      const foreignKeys = db.query('PRAGMA foreign_keys;').get() as { foreign_keys: number }
      expect(foreignKeys.foreign_keys).toBe(1)

      const userVersion = db.query('PRAGMA user_version;').get() as { user_version: number }
      expect(userVersion.user_version).toBe(3)
    } finally {
      db.close()
    }
  })

  it('upgrades existing v1 database to v2 migration cleanly', () => {
    const dbPath = join(tempDir, 'v1.db')
    const rawDb = new Database(dbPath)
    // Run migration 1 manually
    rawDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cwd TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        turns INTEGER NOT NULL DEFAULT 0,
        messages INTEGER NOT NULL DEFAULT 0,
        steps INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        lock_pid INTEGER,
        lock_at INTEGER
      );
      CREATE TABLE messages (thread_id TEXT, seq INTEGER, json TEXT, PRIMARY KEY (thread_id, seq));
      CREATE TABLE blobs (hash TEXT PRIMARY KEY, size INTEGER NOT NULL, data BLOB NOT NULL);
      CREATE TABLE checkpoints (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT, seq INTEGER, created_at INTEGER, tool TEXT, tool_call_id TEXT);
      CREATE TABLE checkpoint_files (checkpoint_id INTEGER, path TEXT, before_hash TEXT, after_hash TEXT, mode INTEGER);
      PRAGMA user_version = 1;
    `)
    rawDb.close()

    const upgraded = openDb(dbPath)
    try {
      const row = upgraded.query('PRAGMA user_version;').get() as { user_version: number }
      expect(row.user_version).toBe(3)

      // Verify columns last_status, last_exit_code, lock_host exist
      const threadInfo = upgraded.query("PRAGMA table_info('threads');").all() as { name: string }[]
      const colNames = threadInfo.map((c) => c.name)
      expect(colNames).toContain('last_status')
      expect(colNames).toContain('last_exit_code')
      expect(colNames).toContain('lock_host')
    } finally {
      upgraded.close()
    }
  })

  it('throws when database user_version is from a newer version', () => {
    const dbPath = join(tempDir, 'future.db')
    const rawDb = new Database(dbPath)
    rawDb.run('PRAGMA user_version = 999;')
    rawDb.close()

    expect(() => openDb(dbPath)).toThrow(/created by a newer ant/)
  })

  it('detects process liveness with pidAlive', () => {
    expect(pidAlive(process.pid)).toBe(true)
    // Non-existent PID
    expect(pidAlive(9999999)).toBe(false)
  })

  it('manages leases safely', () => {
    const db = openDb()
    try {
      const thread = createThread(db, {
        prompt: 'Testing lease',
        cwd: tempDir,
        model: 'google/gemini-2.5-flash',
      })

      // 1. Acquire lease
      acquireLease(db, thread.id)
      const row = db.query('SELECT lock_pid FROM threads WHERE id = ?').get(thread.id) as { lock_pid: number }
      expect(row.lock_pid).toBe(process.pid)

      // 2. Re-acquire by same PID succeeds
      expect(() => acquireLease(db, thread.id)).not.toThrow()

      // 3. Stale lease from dead PID is taken over
      db.run('UPDATE threads SET lock_pid = 9999999, lock_at = ? WHERE id = ?', [Date.now() - 10000, thread.id])
      acquireLease(db, thread.id)
      const rowAfterStale = db.query('SELECT lock_pid FROM threads WHERE id = ?').get(thread.id) as { lock_pid: number }
      expect(rowAfterStale.lock_pid).toBe(process.pid)

      // 4. Release lease
      releaseLease(db, thread.id)
      const rowAfterRelease = db.query('SELECT lock_pid FROM threads WHERE id = ?').get(thread.id) as { lock_pid: number | null }
      expect(rowAfterRelease.lock_pid).toBeNull()

      // 5. Active lease by another live process rejects acquisition when fresh
      if (process.ppid && pidAlive(process.ppid)) {
        db.run('UPDATE threads SET lock_pid = ?, lock_at = ? WHERE id = ?', [process.ppid, Date.now(), thread.id])
        expect(() => acquireLease(db, thread.id)).toThrow(new RegExp(`thread ${thread.id} is in use by pid ${process.ppid}`))

        // Stale lease with old lock_at (>30s) can be taken over even if pid is alive (B-009)
        db.run('UPDATE threads SET lock_pid = ?, lock_at = ? WHERE id = ?', [process.ppid, Date.now() - 40000, thread.id])
        expect(() => acquireLease(db, thread.id)).not.toThrow()
      }
    } finally {
      db.close()
    }
  })

  it('strictly enforces foreign key constraints', () => {
    const db = openDb()
    try {
      expect(() => {
        db.run('INSERT INTO messages (thread_id, seq, json) VALUES (?, ?, ?)', [
          'th_nonexistent_id',
          1,
          JSON.stringify({ role: 'user', content: 'hello' }),
        ])
      }).toThrow(/FOREIGN KEY constraint failed/i)
    } finally {
      db.close()
    }
  })
})
