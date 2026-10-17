import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProgram } from '../src/main.ts'
import { openDb, acquireLease, releaseLease } from '../src/store/db.ts'
import { createThread } from '../src/store/threads.ts'
import { JsonSink, StreamJsonSink } from '../src/output/sink.ts'
import { ResultSchema, StreamEventSchema } from '../src/output/schema.ts'
import type { ModelOutcome } from '../src/core/types.ts'

describe('CLI subsystem (hardcore race conditions, options precedence, stdout/stderr invariants)', () => {
  const originalArgv = process.argv
  const originalEnv = { ...process.env }
  let tempDir: string
  let stderrBuf: string
  let stdoutBuf: string
  let origStderrWrite: typeof process.stderr.write
  let origStdoutWrite: typeof process.stdout.write

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ant-cli-test-'))
    process.env = { ...originalEnv }
    process.env.ANT_HOME = tempDir
    process.env.ANT_MODEL = 'google/gemini-2.5-flash'
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'mock-key'
    process.exitCode = 0
    stderrBuf = ''
    stdoutBuf = ''
    origStderrWrite = process.stderr.write
    origStdoutWrite = process.stdout.write

    process.stderr.write = ((chunk: unknown) => {
      stderrBuf += String(chunk)
      return true
    }) as typeof process.stderr.write

    process.stdout.write = ((chunk: unknown) => {
      stdoutBuf += String(chunk)
      return true
    }) as typeof process.stdout.write
  })

  afterEach(() => {
    process.argv = originalArgv
    process.env = originalEnv
    process.stderr.write = origStderrWrite
    process.stdout.write = origStdoutWrite
    process.exitCode = 0
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('race conditions and concurrency locks', () => {
    it('race condition: concurrent processes competing for the same thread lease', async () => {
      const db1 = openDb()
      const db2 = openDb()

      try {
        const thread = createThread(db1, {
          prompt: 'Concurrent race test',
          cwd: tempDir,
          model: 'google/gemini-2.5-flash',
        })

        // Simulate concurrent process acquiring the lock
        db1.run('UPDATE threads SET lock_pid = 1 WHERE id = ?', [thread.id])

        // db2 attempts to acquire and is rejected
        expect(() => acquireLease(db2, thread.id)).toThrow(/is in use by pid 1/)

        // Lock is released
        db1.run('UPDATE threads SET lock_pid = NULL WHERE id = ?', [thread.id])

        // Now db2 can acquire cleanly without race failure
        expect(() => acquireLease(db2, thread.id)).not.toThrow()
        releaseLease(db2, thread.id)
      } finally {
        db1.close()
        db2.close()
      }
    })

    it('stale lock recovery: dead PID lock is automatically broken by incoming worker', () => {
      const db = openDb()
      try {
        const thread = createThread(db, {
          prompt: 'Dead worker lock test',
          cwd: tempDir,
          model: 'google/gemini-2.5-flash',
        })

        // Fake a dead process PID (9999999) from 1 hour ago
        db.run('UPDATE threads SET lock_pid = 9999999, lock_at = ? WHERE id = ?', [
          Date.now() - 3600000,
          thread.id,
        ])

        // New worker arrives; should not throw because PID 9999999 is dead
        expect(() => acquireLease(db, thread.id)).not.toThrow()
        releaseLease(db, thread.id)
      } finally {
        db.close()
      }
    })
  })

  describe('CLI arguments, edge cases, and options precedence', () => {
    it('rejects whitespace-only prompts with usage_error exit code 2', async () => {
      const program = createProgram()
      try {
        await program.parseAsync(['node', 'ant', '-p', '   \t\n  '])
      } catch {}

      expect(process.exitCode).toBe(2)
      expect(stderrBuf).toContain('cannot be empty or whitespace only')
    })

    it('rejects conflicting --continue and --resume options', async () => {
      const program = createProgram()
      try {
        await program.parseAsync(['node', 'ant', '-p', 'hello', '--continue', '--resume', 'th_123'])
      } catch {}

      expect(process.exitCode).toBe(2)
      expect(stderrBuf).toContain('Cannot specify both --continue and --resume')
    })

    it('rejects invalid permission modes with usage_error exit code 2', async () => {
      const invalidModes = ['invalid_mode', 'sudo', 'custom', 'unsupported']
      for (const mode of invalidModes) {
        stderrBuf = ''
        process.exitCode = 0
        const program = createProgram()
        try {
          await program.parseAsync(['node', 'ant', '-p', 'run', '--permission-mode', mode])
        } catch {}

        expect(process.exitCode).toBe(2)
        expect(stderrBuf).toContain(`Invalid permission-mode: "${mode}"`)
      }
    })

    it('subcommands are dispatched properly rather than treated as user prompts', () => {
      const program = createProgram()
      const commandNames = program.commands.map((c) => c.name())
      expect(commandNames).toContain('threads')
      expect(commandNames).toContain('checkpoints')
      expect(commandNames).toContain('config')
      expect(commandNames).toContain('mcp')
    })
  })

  describe('strict stdout vs stderr separation under machine-readable modes', () => {
    it('json mode: stdout contains ONLY valid parseable Result JSON, no logs or diagnostics', () => {
      stdoutBuf = ''
      const sink = new JsonSink({
        threadId: 'th_test_json',
        model: 'google/gemini-2.5-flash',
        startTime: Date.now() - 100,
      })

      const outcome: ModelOutcome = {
        status: 'completed',
        exitCode: 0,
        text: 'Clean machine readable output.',
        stepsExecuted: 1,
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
      }

      sink.finish(outcome)

      // Stdout must parse cleanly as JSON and conform to ResultSchema
      const parsed = JSON.parse(stdoutBuf.trim())
      const validated = ResultSchema.parse(parsed)
      expect(validated.schema_version).toBe(1)
      expect(validated.type).toBe('result')
      expect(validated.subtype).toBe('success')
      expect(validated.is_error).toBe(false)
      expect(validated.exit_code).toBe(0)
      expect(validated.result).toBe('Clean machine readable output.')
    })

    it('stream-json mode: stdout contains strictly line-delimited NDJSON events ending in result', () => {
      stdoutBuf = ''
      const sink = new StreamJsonSink({
        threadId: 'th_stream_test',
        model: 'google/gemini-2.5-flash',
        startTime: Date.now() - 200,
      })

      sink.emitInit({
        model: 'google/gemini-2.5-flash',
        tools: ['ReadFile'],
      })
      sink.onEvent({ type: 'text-delta', delta: 'Hello ' })
      sink.onEvent({ type: 'text-delta', delta: 'world!' })

      const outcome: ModelOutcome = {
        status: 'completed',
        exitCode: 0,
        text: 'Hello world!',
        stepsExecuted: 1,
      }
      sink.finish(outcome)

      const lines = stdoutBuf.trim().split('\n')
      expect(lines.length).toBe(4) // init, delta, delta, result

      for (const line of lines) {
        const event = JSON.parse(line)
        const validated = StreamEventSchema.parse(event)
        expect(validated.schema_version).toBe(1)
        expect(typeof validated.ts).toBe('string')
      }

      const lastEvent = JSON.parse(lines[lines.length - 1]!)
      expect(lastEvent.type).toBe('result')
      expect(lastEvent.result).toBe('Hello world!')
      expect(lastEvent.exit_code).toBe(0)
    })
  })
})
