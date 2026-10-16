import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db.ts'
import { createThread } from './threads.ts'
import {
  getCheckpoint,
  listCheckpoints,
  recordCheckpoint,
  restoreCheckpoint,
} from './checkpoints.ts'
import { atomicWrite, snapshot } from '../tools/fs.ts'

describe('checkpoints store and restoration engine', () => {
  let tempDir: string
  let origAntHome: string | undefined

  beforeEach(() => {
    origAntHome = process.env.ANT_HOME
    tempDir = mkdtempSync(join(tmpdir(), 'ant-ckpts-test-'))
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

  it('records sequential checkpoints and links content-addressed blobs', () => {
    const db = openDb()
    try {
      const thread = createThread(db, {
        prompt: 'Checkpoint test',
        cwd: tempDir,
        model: 'google/gemini-2.5-flash',
      })
      const filePath = join(tempDir, 'file.txt')

      // 1. Create file.txt -> checkpoint #1
      const before1 = null
      atomicWrite(filePath, 'version 1')
      const after1 = snapshot(filePath)

      const seq1 = recordCheckpoint(db, thread.id, 'WriteFile', 'call_1', [
        { path: 'file.txt', before: before1, after: after1 },
      ])
      expect(seq1).toBe(1)

      // 2. Edit file.txt -> checkpoint #2
      const before2 = after1
      atomicWrite(filePath, 'version 2')
      const after2 = snapshot(filePath)

      const seq2 = recordCheckpoint(db, thread.id, 'EditFile', 'call_2', [
        { path: 'file.txt', before: before2, after: after2 },
      ])
      expect(seq2).toBe(2)

      // List checkpoints
      const list = listCheckpoints(db, thread.id)
      expect(list.length).toBe(2)
      expect(list[0]!.seq).toBe(1)
      expect(list[0]!.tool).toBe('WriteFile')
      expect(list[0]!.files[0]!.status).toBe('+')
      expect(list[1]!.seq).toBe(2)
      expect(list[1]!.tool).toBe('EditFile')
      expect(list[1]!.files[0]!.status).toBe('~')

      // Get single checkpoint
      const cp1 = getCheckpoint(db, thread.id, 1)
      expect(cp1.seq).toBe(1)
      expect(cp1.files[0]!.afterHash).toBe(after1!.hash)
    } finally {
      db.close()
    }
  })

  it('restores workspace to before a checkpoint with CAS safety', () => {
    const db = openDb()
    try {
      const thread = createThread(db, {
        prompt: 'Restore test',
        cwd: tempDir,
        model: 'google/gemini-2.5-flash',
      })
      const file1Path = join(tempDir, 'a.txt')
      const file2Path = join(tempDir, 'b.txt')

      // Checkpoint #1: Create a.txt
      atomicWrite(file1Path, 'a-initial')
      const afterA1 = snapshot(file1Path)
      recordCheckpoint(db, thread.id, 'WriteFile', 'call_1', [
        { path: 'a.txt', before: null, after: afterA1 },
      ])

      // Checkpoint #2: Create b.txt
      atomicWrite(file2Path, 'b-initial')
      const afterB = snapshot(file2Path)
      recordCheckpoint(db, thread.id, 'WriteFile', 'call_2', [
        { path: 'b.txt', before: null, after: afterB },
      ])

      // Checkpoint #3: Modify a.txt
      atomicWrite(file1Path, 'a-modified')
      const afterA2 = snapshot(file1Path)
      recordCheckpoint(db, thread.id, 'EditFile', 'call_3', [
        { path: 'a.txt', before: afterA1, after: afterA2 },
      ])

      expect(readFileSync(file1Path, 'utf-8')).toBe('a-modified')
      expect(existsSync(file2Path)).toBe(true)

      // 1. Dry run restoration to before Checkpoint #2:
      // Should delete b.txt and revert a.txt back to 'a-initial'
      const dryRunRes = restoreCheckpoint(db, thread.id, 2, { cwd: tempDir, dryRun: true })
      expect(dryRunRes.dryRun).toBe(true)
      expect(dryRunRes.plan.length).toBe(2)
      // Disk should remain untouched in dry run
      expect(readFileSync(file1Path, 'utf-8')).toBe('a-modified')
      expect(existsSync(file2Path)).toBe(true)

      // 2. Perform actual restoration to before Checkpoint #2
      const res = restoreCheckpoint(db, thread.id, 2, { cwd: tempDir })
      expect(res.dryRun).toBe(false)
      expect(res.restoredSeq).toBe(4) // New restore checkpoint created (#4)

      // Verify disk states:
      // a.txt reverted to 'a-initial'
      expect(readFileSync(file1Path, 'utf-8')).toBe('a-initial')
      // b.txt deleted
      expect(existsSync(file2Path)).toBe(false)
    } finally {
      db.close()
    }
  })

  it('detects CAS #2 conflicts and aborts unless --force is specified', () => {
    const db = openDb()
    try {
      const thread = createThread(db, {
        prompt: 'Conflict test',
        cwd: tempDir,
        model: 'google/gemini-2.5-flash',
      })
      const filePath = join(tempDir, 'file.txt')

      // Checkpoint #1: Create file.txt with 'original'
      atomicWrite(filePath, 'original')
      const after = snapshot(filePath)
      recordCheckpoint(db, thread.id, 'WriteFile', 'call_1', [
        { path: 'file.txt', before: null, after },
      ])

      // External modification outside ant
      writeFileSync(filePath, 'external modification by user')

      // Attempt restore to checkpoint #1 -> must detect conflict and throw
      expect(() => restoreCheckpoint(db, thread.id, 1, { cwd: tempDir })).toThrow(
        /conflicting modifications detected/i,
      )

      // Disk is untouched
      expect(readFileSync(filePath, 'utf-8')).toBe('external modification by user')

      // Using force: true succeeds
      const forcedRes = restoreCheckpoint(db, thread.id, 1, { cwd: tempDir, force: true })
      expect(forcedRes.dryRun).toBe(false)
      // Checkpoint #1 was creation, so rewind to before #1 deletes file.txt
      expect(existsSync(filePath)).toBe(false)
    } finally {
      db.close()
    }
  })

  it('throws when attempting to restore non-existent checkpoint', () => {
    const db = openDb()
    try {
      const thread = createThread(db, {
        prompt: 'Missing ckpt',
        cwd: tempDir,
        model: 'google/gemini-2.5-flash',
      })
      expect(() => restoreCheckpoint(db, thread.id, 99, { cwd: tempDir })).toThrow(
        /Checkpoint #99 does not exist/,
      )
    } finally {
      db.close()
    }
  })
})
