import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, getDbPath, acquireLease, releaseLease } from '../src/store/db.ts'
import { createThread, appendMessage, getMessages, formatTitle } from '../src/store/threads.ts'
import { repairHistory } from '../src/store/repair.ts'
import { recordCheckpoint, restoreCheckpoint } from '../src/store/checkpoints.ts'
import { ThreadRun } from '../src/store/threadRun.ts'
import { atomicWrite, snapshot } from '../src/tools/fs.ts'
import { resolveEffectivePermissions } from '../src/policy/toolPermissions.ts'
import type { ModelMessage } from 'ai'
import type { Config } from '../src/core/types.ts'

describe('threads subsystem (database, threadRun, history repair, checkpoints, leases)', () => {
  let tempDir: string
  let origAntHome: string | undefined

  beforeEach(() => {
    origAntHome = process.env.ANT_HOME
    tempDir = mkdtempSync(join(tmpdir(), 'ant-threads-test-'))
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

  describe('database initialization, security modes, and schema migration', () => {
    it('creates sqlite database with 0700 dir, 0600 file modes, and WAL pragma', () => {
      const db = openDb()
      try {
        const dbPath = getDbPath()
        const dirStat = statSync(tempDir)
        const fileStat = statSync(dbPath)

        expect(dirStat.mode & 0o777).toBe(0o700)
        expect(fileStat.mode & 0o777).toBe(0o600)

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
  })

  describe('thread creation, leases, and message history', () => {
    it('creates, retrieves, and acquires exclusive leases on threads', () => {
      const db = openDb()
      try {
        const thread = createThread(db, {
          prompt: 'Fix payment webhook bug',
          cwd: tempDir,
          model: 'google/gemini-2.5-flash',
        })

        expect(thread.id).toMatch(/^th_\d+_[0-9a-f]{8}$/)
        expect(thread.title).toBe('Fix payment webhook bug')

        // Acquire lease
        acquireLease(db, thread.id)

        // Attempting lease when locked by another active pid throws
        db.run('UPDATE threads SET lock_pid = 1 WHERE id = ?', [thread.id])
        expect(() => acquireLease(db, thread.id)).toThrow(/is in use by pid/)

        // Release lease
        releaseLease(db, thread.id)

        // Append message and retrieve
        appendMessage(db, thread.id, { role: 'user', content: 'Check the webhook logs' })
        const msgs = getMessages(db, thread.id)
        expect(msgs.length).toBe(1)
        expect(msgs[0]?.role).toBe('user')
        expect(msgs[0]?.content).toBe('Check the webhook logs')
      } finally {
        db.close()
      }
    })

    it('formats thread titles with whitespace normalization and truncation', () => {
      expect(formatTitle('   clean    up   logs   \n ')).toBe('clean up logs')
      const longTitle = 'word '.repeat(30)
      const formatted = formatTitle(longTitle)
      expect(formatted.length).toBe(80)
      expect(formatted.endsWith('…')).toBe(true)
    })
  })

  describe('history repair engine', () => {
    it('repairs history ending with uncompleted user message', () => {
      const input: ModelMessage[] = [{ role: 'user', content: 'run query' }]
      const { messages, repaired } = repairHistory(input)

      expect(messages.length).toBe(2)
      expect(messages[1]?.role).toBe('assistant')
      expect(repaired.length).toBe(1)
    })

    it('repairs orphan tool calls lacking tool results', () => {
      const input: ModelMessage[] = [
        { role: 'user', content: 'fetch files' },
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'c1', toolName: 'Bash', input: { command: 'ls' } },
          ],
        },
      ]
      const { messages, repaired } = repairHistory(input)

      expect(messages.length).toBe(3)
      expect(messages[2]?.role).toBe('tool')
      expect(repaired.some((r) => r.includes('orphan tool call'))).toBe(true)
    })
  })

  describe('checkpoints and file restoration', () => {
    it('records checkpoints and restores modified files to prior state', () => {
      const db = openDb()
      try {
        const thread = createThread(db, {
          prompt: 'Refactor test',
          cwd: tempDir,
          model: 'google/gemini-2.5-flash',
        })
        const filePath = join(tempDir, 'app.ts')

        // Initial write
        atomicWrite(filePath, 'const a = 1;')
        const snap1 = snapshot(filePath)

        const seq1 = recordCheckpoint(db, thread.id, 'WriteFile', 'call_1', [
          { path: 'app.ts', before: null, after: snap1 },
        ])
        expect(seq1).toBe(1)

        // Modification
        atomicWrite(filePath, 'const a = 2;')
        const snap2 = snapshot(filePath)
        const seq2 = recordCheckpoint(db, thread.id, 'EditFile', 'call_2', [
          { path: 'app.ts', before: snap1, after: snap2 },
        ])
        expect(seq2).toBe(2)

        // Restore back to before checkpoint 2
        const restoreResult = restoreCheckpoint(db, thread.id, 2, { cwd: tempDir })
        expect(restoreResult.plan.map((p) => p.path)).toEqual(['app.ts'])
        expect(readFileSync(filePath, 'utf-8')).toBe('const a = 1;')
      } finally {
        db.close()
      }
    })

    it('detects conflicts when restoring a file modified externally', () => {
      const db = openDb()
      try {
        const thread = createThread(db, {
          prompt: 'Conflict test',
          cwd: tempDir,
          model: 'google/gemini-2.5-flash',
        })
        const filePath = join(tempDir, 'config.json')

        atomicWrite(filePath, '{"v": 1}')
        const snap1 = snapshot(filePath)

        recordCheckpoint(db, thread.id, 'WriteFile', 'call_1', [
          { path: 'config.json', before: null, after: snap1 },
        ])

        // External modification that does not match expected state
        writeFileSync(filePath, '{"v": 999}')

        expect(() => restoreCheckpoint(db, thread.id, 1, { cwd: tempDir })).toThrow(
          /conflicting modifications detected outside ant/,
        )
      } finally {
        db.close()
      }
    })
  })

  describe('ThreadRun lifecycle coordinator', () => {
    const mockConfig = {
      model: 'google/gemini-2.5-flash',
      prompt: 'Lifecycle test prompt',
      cwd: tempDir,
      effectivePermissions: resolveEffectivePermissions({
        mode: 'default',
        allowedRules: [],
        disallowedRules: [],
      }),
      noSessionPersistence: false,
    } as unknown as Config

    it('opens thread, records checkpoints, and handles cleanup on close', () => {
      const threadRun = ThreadRun.open({
        config: mockConfig,
        realCwd: tempDir,
      })

      expect(threadRun.thread.id).toMatch(/^th_/)
      expect(threadRun.isNewThread).toBe(true)

      const filePath = join(tempDir, 'demo.txt')
      atomicWrite(filePath, 'checkpoint demo')
      const snap = snapshot(filePath)

      const seq = threadRun.recordCheckpoint('WriteFile', 'call_demo', [
        { path: 'demo.txt', before: null, after: snap },
      ])
      expect(seq).toBe(1)
      expect(threadRun.createdCheckpoints).toEqual([1])

      // Finalize and close threadRun
      threadRun.finalizeOutcome({
        status: 'completed',
        exitCode: 0,
        text: 'done',
        stepsExecuted: 1,
      })
      threadRun.close()
      expect(threadRun.db).not.toBeNull()
    })

    it('supports no-session-persistence mode without sqlite database', () => {
      const ephemeralRun = ThreadRun.open({
        config: { ...mockConfig, noSessionPersistence: true } as unknown as Config,
        realCwd: tempDir,
      })

      expect(ephemeralRun.db).toBeNull()
      expect(ephemeralRun.thread.id).toBe('ephemeral')

      // Checkpoints return 0 in ephemeral mode
      const seq = ephemeralRun.recordCheckpoint('WriteFile', 'c1', [])
      expect(seq).toBe(0)

      ephemeralRun.finalizeOutcome({
        status: 'completed',
        exitCode: 0,
        text: 'done ephemeral',
        stepsExecuted: 1,
      })
      ephemeralRun.close()
    })
  })
})
