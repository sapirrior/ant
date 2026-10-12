import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProgram } from '../main.ts'
import { openDb } from '../store/db.ts'
import { createThread } from '../store/threads.ts'
import { recordCheckpoint } from '../store/checkpoints.ts'
import { snapshot } from '../tools/fs.ts'

describe('ant checkpoints CLI command', () => {
  let tempDir: string
  let origAntHome: string | undefined
  let origStdoutWrite: typeof process.stdout.write
  let origStderrWrite: typeof process.stderr.write
  let stdoutBuf: string
  let stderrBuf: string

  beforeEach(() => {
    origAntHome = process.env.ANT_HOME
    tempDir = mkdtempSync(join(tmpdir(), 'ant-cli-ckpts-test-'))
    process.env.ANT_HOME = tempDir

    stdoutBuf = ''
    stderrBuf = ''
    origStdoutWrite = process.stdout.write
    origStderrWrite = process.stderr.write

    process.stdout.write = ((chunk: unknown) => {
      stdoutBuf += String(chunk)
      return true
    }) as typeof process.stdout.write

    process.stderr.write = ((chunk: unknown) => {
      stderrBuf += String(chunk)
      return true
    }) as typeof process.stderr.write
  })

  afterEach(() => {
    process.stdout.write = origStdoutWrite
    process.stderr.write = origStderrWrite

    if (origAntHome !== undefined) {
      process.env.ANT_HOME = origAntHome
    } else {
      delete process.env.ANT_HOME
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('lists checkpoints with --json', async () => {
    const db = openDb()
    const t = createThread(db, { prompt: 'CLI ckpt list test', cwd: process.cwd(), model: 'google/gemini-2.5-flash' })
    const file = join(tempDir, 'demo.txt')
    writeFileSync(file, 'hello')
    const snap = snapshot(file)
    recordCheckpoint(db, t.id, 'WriteFile', 'call_1', [{ path: 'demo.txt', before: null, after: snap }])
    db.close()

    const program = createProgram()
    await program.parseAsync(['node', 'ant', 'checkpoints', 'list', '--thread', t.id, '--json'])

    expect(stdoutBuf).toContain(t.id)
    const parsed = JSON.parse(stdoutBuf)
    expect(parsed.threadId).toBe(t.id)
    expect(parsed.checkpoints.length).toBe(1)
    expect(parsed.checkpoints[0].tool).toBe('WriteFile')
  })

  it('shows details for a single checkpoint sequence', async () => {
    const db = openDb()
    const t = createThread(db, { prompt: 'CLI ckpt show test', cwd: process.cwd(), model: 'google/gemini-2.5-flash' })
    const file = join(tempDir, 'demo.txt')
    writeFileSync(file, 'hello')
    const snap = snapshot(file)
    recordCheckpoint(db, t.id, 'WriteFile', 'call_1', [{ path: 'demo.txt', before: null, after: snap }])
    db.close()

    const program = createProgram()
    await program.parseAsync(['node', 'ant', 'checkpoints', 'show', '1', '--thread', t.id, '--json'])

    const parsed = JSON.parse(stdoutBuf)
    expect(parsed.seq).toBe(1)
    expect(parsed.tool).toBe('WriteFile')
    expect(parsed.files[0].path).toBe('demo.txt')
  })

  it('restores workspace via CLI', async () => {
    const origCwd = process.cwd()
    process.chdir(tempDir)
    try {
      const db = openDb()
      const t = createThread(db, { prompt: 'CLI restore test', cwd: tempDir, model: 'google/gemini-2.5-flash' })
      const file = join(tempDir, 'app.ts')

      // Checkpoint 1: Initial write
      writeFileSync(file, 'v1')
      const snap1 = snapshot(file)
      recordCheckpoint(db, t.id, 'WriteFile', 'call_1', [{ path: 'app.ts', before: null, after: snap1 }])

      // Checkpoint 2: Second write
      writeFileSync(file, 'v2')
      const snap2 = snapshot(file)
      recordCheckpoint(db, t.id, 'EditFile', 'call_2', [{ path: 'app.ts', before: snap1, after: snap2 }])
      db.close()

      expect(readFileSync(file, 'utf-8')).toBe('v2')

      // Restore to before Checkpoint 2
      const program = createProgram()
      await program.parseAsync(['node', 'ant', 'checkpoints', 'restore', '2', '--thread', t.id])

      expect(stdoutBuf).toContain('restored workspace to before checkpoint #2')
      expect(readFileSync(file, 'utf-8')).toBe('v1')
    } finally {
      process.chdir(origCwd)
    }
  })
})
