import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProgram } from '../main.ts'
import { openDb } from '../store/db.ts'
import { createThread, appendMessage } from '../store/threads.ts'

describe('ant threads CLI command', () => {
  let tempDir: string
  let origAntHome: string | undefined
  let origStdoutWrite: typeof process.stdout.write
  let origStderrWrite: typeof process.stderr.write
  let stdoutBuf: string
  let stderrBuf: string

  beforeEach(() => {
    origAntHome = process.env.ANT_HOME
    tempDir = mkdtempSync(join(tmpdir(), 'ant-cli-threads-test-'))
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

  it('lists threads with --json', async () => {
    const db = openDb()
    const t = createThread(db, { prompt: 'CLI list test', cwd: process.cwd(), model: 'google/gemini-2.5-flash' })
    db.close()

    const program = createProgram()
    await program.parseAsync(['node', 'ant', 'threads', 'list', '--json'])

    expect(stdoutBuf).toContain(t.id)
    const parsed = JSON.parse(stdoutBuf)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0].id).toBe(t.id)
    expect(parsed[0].title).toBe('CLI list test')
  })

  it('shows thread details and messages with --messages', async () => {
    const db = openDb()
    const t = createThread(db, { prompt: 'CLI show test', cwd: process.cwd(), model: 'google/gemini-2.5-flash' })
    appendMessage(db, t.id, { role: 'user', content: 'What is the date?' })
    db.close()

    const program = createProgram()
    await program.parseAsync(['node', 'ant', 'threads', 'show', t.id, '--messages'])

    expect(stdoutBuf).toContain(`ID:           ${t.id}`)
    expect(stdoutBuf).toContain('CLI show test')
    expect(stdoutBuf).toContain('[user]')
    expect(stdoutBuf).toContain('What is the date?')
  })

  it('renames a thread', async () => {
    const db = openDb()
    const t = createThread(db, { prompt: 'Before rename', cwd: process.cwd(), model: 'google/gemini-2.5-flash' })
    db.close()

    const program = createProgram()
    await program.parseAsync(['node', 'ant', 'threads', 'rename', t.id, 'New', 'title', 'here'])

    expect(stdoutBuf).toContain(`renamed thread ${t.id} to "New title here"`)
  })

  it('deletes a thread with -y', async () => {
    const db = openDb()
    const t = createThread(db, { prompt: 'To delete via CLI', cwd: process.cwd(), model: 'google/gemini-2.5-flash' })
    db.close()

    const program = createProgram()
    await program.parseAsync(['node', 'ant', 'threads', 'delete', t.id, '-y'])

    expect(stdoutBuf).toContain(`deleted thread ${t.id}`)
  })
})
