import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createProgram } from '../main.ts'

describe('CLI run command contract', () => {
  const originalArgv = process.argv
  const originalEnv = { ...process.env }
  let stderrBuf: string
  let stdoutBuf: string
  let origStderrWrite: typeof process.stderr.write
  let origStdoutWrite: typeof process.stdout.write

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.ANT_MODEL = 'openai/gpt-4o'
    process.env.OPENAI_API_KEY = 'mock-key'
    process.exitCode = undefined
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
  })

  it('accepts positional prompt without -p or --print', async () => {
    const program = createProgram()
    try {
      await program.parseAsync(['node', 'ant', 'Explain this code'])
    } catch {}

    // It should not fail with "ant requires -p/--print"
    expect(stderrBuf).not.toContain('ant requires -p/--print')
  })

  it('rejects whitespace-only prompt', async () => {
    const program = createProgram()
    try {
      await program.parseAsync(['node', 'ant', '-p', '   '])
    } catch {}

    expect(process.exitCode).toBe(2)
    expect(stderrBuf).toContain('cannot be empty or whitespace only')
  })

  it('rejects conflicting --continue and --resume', async () => {
    const program = createProgram()
    try {
      await program.parseAsync(['node', 'ant', '-p', '--continue', '--resume', '123'])
    } catch {}

    expect(process.exitCode).toBe(2)
    expect(stderrBuf).toContain('Cannot specify both --continue and --resume')
  })

  it('rejects unsupported flags like --max-budget-usd', async () => {
    const program = createProgram()
    try {
      await program.parseAsync(['node', 'ant', '-p', '--max-budget-usd', '5', 'hello'])
    } catch {}

    expect(stderrBuf).toContain("unknown option '--max-budget-usd'")
  })

  it('rejects unsupported flags like --input-format', async () => {
    const program = createProgram()
    try {
      await program.parseAsync(['node', 'ant', '-p', '--input-format=stream-json', 'hello'])
    } catch {}

    expect(stderrBuf).toContain("unknown option '--input-format=stream-json'")
  })

  it('rejects permission-mode dontAsk', async () => {
    const program = createProgram()
    try {
      await program.parseAsync(['node', 'ant', '-p', '--permission-mode', 'dontAsk', 'hello'])
    } catch {}

    expect(process.exitCode).toBe(2)
    expect(stderrBuf).toContain('Invalid permission-mode: "dontAsk"')
  })

  it('rejects invalid permission-mode', async () => {
    const program = createProgram()
    try {
      await program.parseAsync(['node', 'ant', '-p', '--permission-mode', 'invalid_mode', 'hello'])
    } catch {}

    expect(process.exitCode).toBe(2)
    expect(stderrBuf).toContain('Invalid permission-mode: "invalid_mode"')
  })

  it('rejects permission-mode auto as invalid', async () => {
    const program = createProgram()
    try {
      await program.parseAsync(['node', 'ant', '-p', '--permission-mode', 'auto', 'hello'])
    } catch {}

    expect(process.exitCode).toBe(2)
    expect(stderrBuf).toContain('Invalid permission-mode: "auto"')
  })

  it('dispatches to subcommands rather than interpreting them as prompts', () => {
    const program = createProgram()
    const subcommands = program.commands.map((c) => c.name())
    expect(subcommands).toContain('config')
    expect(subcommands).toContain('threads')
    expect(subcommands).toContain('checkpoints')
    expect(subcommands).toContain('update')
    expect(subcommands).toContain('mcp')
  })
})
