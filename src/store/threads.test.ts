import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db.ts'
import {
  appendMessage,
  createThread,
  deleteThread,
  formatTitle,
  generateThreadId,
  getMessages,
  getThread,
  listThreads,
  recordStepMessages,
  renameThread,
  resolveThreadId,
} from './threads.ts'
import type { ModelMessage } from 'ai'

describe('threads store', () => {
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

  it('generates thread id matching format', () => {
    const id = generateThreadId()
    expect(id).toMatch(/^th_\d+_[0-9a-f]{8}$/)
  })

  it('formats titles with whitespace collapsing and truncation', () => {
    expect(formatTitle('   hello    world  \n  test  ')).toBe('hello world test')
    const long = 'a'.repeat(100)
    const formatted = formatTitle(long)
    expect(formatted.length).toBe(80)
    expect(formatted.endsWith('…')).toBe(true)
  })

  it('creates and retrieves threads', () => {
    const db = openDb()
    try {
      const thread = createThread(db, {
        prompt: 'Fix the login bug',
        cwd: tempDir,
        model: 'google/gemini-2.5-flash',
      })

      expect(thread.title).toBe('Fix the login bug')
      expect(thread.model).toBe('google/gemini-2.5-flash')
      expect(thread.turns).toBe(0)
      expect(thread.messages).toBe(0)

      const fetched = getThread(db, thread.id)
      expect(fetched.id).toBe(thread.id)
      expect(fetched.title).toBe(thread.title)
    } finally {
      db.close()
    }
  })

  it('resolves thread IDs by full ID, unique prefix, and "latest"', async () => {
    const db = openDb()
    try {
      const t1 = createThread(db, {
        prompt: 'First thread',
        cwd: tempDir,
        model: 'google/gemini-2.5-flash',
      })

      // Ensure distinct timestamp
      await new Promise((r) => setTimeout(r, 5))

      const t2 = createThread(db, {
        prompt: 'Second thread',
        cwd: tempDir,
        model: 'google/gemini-2.5-flash',
      })

      // Exact match
      expect(resolveThreadId(db, t1.id)).toBe(t1.id)

      // Prefix match
      const prefix = t1.id.slice(0, 15)
      // If prefix is unique:
      if (!t2.id.startsWith(prefix)) {
        expect(resolveThreadId(db, prefix)).toBe(t1.id)
      }

      // Ambiguous prefix error if prefix matches both
      const commonPrefix = 'th_'
      expect(() => resolveThreadId(db, commonPrefix)).toThrow(/Ambiguous thread ID prefix/)

      // "latest" resolves to t2 (most recent in cwd)
      expect(resolveThreadId(db, 'latest', tempDir)).toBe(t2.id)

      // Not found
      expect(() => resolveThreadId(db, 'th_9999999999_nonexist')).toThrow(/Thread not found/)
    } finally {
      db.close()
    }
  })

  it('lists threads with cwd filtering and limits', () => {
    const db = openDb()
    try {
      createThread(db, { prompt: 'Thread 1', cwd: tempDir, model: 'google/gemini-2.5-flash' })
      createThread(db, { prompt: 'Thread 2', cwd: tempDir, model: 'google/gemini-2.5-flash' })
      createThread(db, { prompt: 'Other CWD', cwd: tmpdir(), model: 'google/gemini-2.5-flash' })

      const localThreads = listThreads(db, { cwd: tempDir })
      expect(localThreads.length).toBe(2)

      const allThreads = listThreads(db, { all: true })
      expect(allThreads.length).toBe(3)

      const limited = listThreads(db, { all: true, limit: 1 })
      expect(limited.length).toBe(1)
    } finally {
      db.close()
    }
  })

  it('renames a thread with strict validation', () => {
    const db = openDb()
    try {
      const t = createThread(db, { prompt: 'Initial title', cwd: tempDir, model: 'google/gemini-2.5-flash' })
      const renamed = renameThread(db, t.id, '  Updated   title  ')
      expect(renamed.title).toBe('Updated title')

      expect(() => renameThread(db, t.id, '   ')).toThrow(/Invalid title length/)
      expect(() => renameThread(db, t.id, 'x'.repeat(121))).toThrow(/Invalid title length/)
    } finally {
      db.close()
    }
  })

  it('deletes a thread and cascades messages', () => {
    const db = openDb()
    try {
      const t = createThread(db, { prompt: 'To delete', cwd: tempDir, model: 'google/gemini-2.5-flash' })
      appendMessage(db, t.id, { role: 'user', content: 'Hello' })
      expect(getMessages(db, t.id).length).toBe(1)

      deleteThread(db, t.id)
      expect(() => getThread(db, t.id)).toThrow(/Thread not found/)

      // Verify cascade
      const msgCount = db.query('SELECT COUNT(*) as cnt FROM messages WHERE thread_id = ?').get(t.id) as { cnt: number }
      expect(msgCount.cnt).toBe(0)
    } finally {
      db.close()
    }
  })

  it('stores and retrieves ModelMessages verbatim', () => {
    const db = openDb()
    try {
      const t = createThread(db, { prompt: 'Conversation', cwd: tempDir, model: 'google/gemini-2.5-flash' })

      const userMsg: ModelMessage = {
        role: 'user',
        content: [{ type: 'text', text: 'Hello, what is 2+2?' }],
      }
      appendMessage(db, t.id, userMsg)

      const assistantMsg: ModelMessage = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me calculate.' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'calculator', input: { expr: '2+2' } },
        ],
      }
      const toolMsg: ModelMessage = {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'calculator', output: { type: 'text', value: '4' } }],
      }

      recordStepMessages(db, t.id, [assistantMsg, toolMsg], 1, { inputTokens: 50, outputTokens: 20 })

      const messages = getMessages(db, t.id)
      expect(messages.length).toBe(3)
      expect(messages[0]).toEqual(userMsg)
      expect(messages[1]).toEqual(assistantMsg)
      expect(messages[2]).toEqual(toolMsg)

      const updatedThread = getThread(db, t.id)
      expect(updatedThread.turns).toBe(1)
      expect(updatedThread.messages).toBe(3)
      expect(updatedThread.steps).toBe(1)
      expect(updatedThread.inputTokens).toBe(50)
      expect(updatedThread.outputTokens).toBe(20)
    } finally {
      db.close()
    }
  })

  it('refuses deletion when active lease is held by a live process', () => {
    const db = openDb()
    try {
      const t = createThread(db, { prompt: 'Active lease test', cwd: tempDir, model: 'google/gemini-2.5-flash' })
      // Simulate active lease held by current process
      db.run('UPDATE threads SET lock_pid = ?, lock_at = ? WHERE id = ?', [process.pid, Date.now(), t.id])

      expect(() => deleteThread(db, t.id)).toThrow(/Cannot delete thread.*active lease held by pid/)
      expect(getThread(db, t.id).id).toBe(t.id)
    } finally {
      db.close()
    }
  })

  it('performs blob GC correctly across multiple checkpoints and threads', () => {
    const db = openDb()
    try {
      const t1 = createThread(db, { prompt: 'Thread A', cwd: tempDir, model: 'google/gemini-2.5-flash' })
      const t2 = createThread(db, { prompt: 'Thread B', cwd: tempDir, model: 'google/gemini-2.5-flash' })

      // Insert 3 blobs
      const hashX = 'hash_x_1111'
      const hashY = 'hash_y_shared'
      const hashZ = 'hash_z_3333'
      db.run('INSERT INTO blobs (hash, size, data) VALUES (?, ?, ?)', [hashX, 10, Buffer.from('blobX')])
      db.run('INSERT INTO blobs (hash, size, data) VALUES (?, ?, ?)', [hashY, 20, Buffer.from('blobY')])
      db.run('INSERT INTO blobs (hash, size, data) VALUES (?, ?, ?)', [hashZ, 30, Buffer.from('blobZ')])

      // Checkpoint on Thread 1 references hashX (before) and hashY (after)
      db.run('INSERT INTO checkpoints (thread_id, seq, created_at, tool) VALUES (?, 1, ?, "WriteFile")', [t1.id, Date.now()])
      const cp1Id = (db.query('SELECT last_insert_rowid() AS id').get() as { id: number }).id
      db.run('INSERT INTO checkpoint_files (checkpoint_id, path, before_hash, after_hash, mode) VALUES (?, "f1.ts", ?, ?, ?)', [cp1Id, hashX, hashY, 0o644])

      // Checkpoint on Thread 2 references hashY (before) and hashZ (after)
      db.run('INSERT INTO checkpoints (thread_id, seq, created_at, tool) VALUES (?, 1, ?, "EditFile")', [t2.id, Date.now()])
      const cp2Id = (db.query('SELECT last_insert_rowid() AS id').get() as { id: number }).id
      db.run('INSERT INTO checkpoint_files (checkpoint_id, path, before_hash, after_hash, mode) VALUES (?, "f2.ts", ?, ?, ?)', [cp2Id, hashY, hashZ, 0o644])

      // Delete Thread 1: hashX must be deleted; hashY must survive because Thread 2 still references it
      deleteThread(db, t1.id)
      const blobX = db.query('SELECT hash FROM blobs WHERE hash = ?').get(hashX)
      const blobY = db.query('SELECT hash FROM blobs WHERE hash = ?').get(hashY)
      const blobZ = db.query('SELECT hash FROM blobs WHERE hash = ?').get(hashZ)
      expect(blobX).toBeNull()
      expect(blobY).not.toBeNull()
      expect(blobZ).not.toBeNull()

      // Delete Thread 2: both hashY and hashZ must now be cleaned up
      deleteThread(db, t2.id)
      expect(db.query('SELECT hash FROM blobs WHERE hash = ?').get(hashY)).toBeNull()
      expect(db.query('SELECT hash FROM blobs WHERE hash = ?').get(hashZ)).toBeNull()
    } finally {
      db.close()
    }
  })

  it('guarantees gapless sequential seq numbers under rapid step appending', () => {
    const db = openDb()
    try {
      const t = createThread(db, { prompt: 'Sequence test', cwd: tempDir, model: 'google/gemini-2.5-flash' })

      for (let i = 0; i < 20; i++) {
        const msgA: ModelMessage = { role: 'assistant', content: [{ type: 'text', text: `step ${i} text` }] }
        const msgB: ModelMessage = { role: 'tool', content: [{ type: 'tool-result', toolCallId: `call_${i}`, toolName: 't', output: { type: 'text', value: 'ok' } }] }
        recordStepMessages(db, t.id, [msgA, msgB], 1, { inputTokens: 10, outputTokens: 5 })
      }

      const seqRows = db
        .query('SELECT seq FROM messages WHERE thread_id = ? ORDER BY seq ASC')
        .all(t.id) as { seq: number }[]

      expect(seqRows.length).toBe(40)
      for (let i = 0; i < 40; i++) {
        expect(seqRows[i]!.seq).toBe(i + 1)
      }
    } finally {
      db.close()
    }
  })

  it('correctly preserves complex multimodal/reasoning and large ModelMessage payloads', () => {
    const db = openDb()
    try {
      const t = createThread(db, { prompt: 'Complex message test', cwd: tempDir, model: 'google/gemini-2.5-flash' })

      const complexMsg: ModelMessage = {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Thinking step with special chars: 🚀 <html> & "quotes" \n\t multi-line' },
          { type: 'text', text: 'Here is the answer: ' + 'x'.repeat(50000) },
          {
            type: 'tool-call',
            toolCallId: 'call_99',
            toolName: 'complexTool',
            input: {
              nested: { array: [1, null, true, { key: 'value' }] },
              unicode: '你好世界 🌍',
            },
          },
        ],
      }

      appendMessage(db, t.id, complexMsg)
      const retrieved = getMessages(db, t.id)
      expect(retrieved.length).toBe(1)
      expect(retrieved[0]).toEqual(complexMsg)
    } finally {
      db.close()
    }
  })
})
