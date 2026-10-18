import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { StderrLogger } from '../src/output/log.ts'
import { installStdoutGuard, restoreStdout } from '../src/output/guard.ts'
import { DARK_THEME, LIGHT_THEME, ANSI_16_MAP, createColorFormatter } from '../src/output/color.ts'
import { TextSink, StreamJsonSink } from '../src/output/sink.ts'

describe('output subsystem (print agent invariants, guard, logger, sinks)', () => {
  describe('StreamStdoutGuard: strictly guards stdout against non-JSON pollution', () => {
    let stdoutBuf: string[] = []
    let stderrBuf: string[] = []
    let origStdoutWrite: typeof process.stdout.write
    let origStderrWrite: typeof process.stderr.write

    beforeEach(() => {
      stdoutBuf = []
      stderrBuf = []
      origStdoutWrite = process.stdout.write
      origStderrWrite = process.stderr.write

      process.stdout.write = ((chunk: any) => {
        stdoutBuf.push(String(chunk))
        return true
      }) as any

      process.stderr.write = ((chunk: any) => {
        stderrBuf.push(String(chunk))
        return true
      }) as any
    })

    afterEach(() => {
      restoreStdout()
      process.stdout.write = origStdoutWrite
      process.stderr.write = origStderrWrite
    })

    it('passes valid JSON objects and arrays directly to stdout', () => {
      installStdoutGuard()

      process.stdout.write('{"type":"step_start"}\n')
      process.stdout.write('["item1","item2"]\n')

      expect(stdoutBuf.join('')).toBe('{"type":"step_start"}\n["item1","item2"]\n')
      expect(stderrBuf.length).toBe(0)
    })

    it('diverts non-JSON text and rogue logging to stderr', () => {
      installStdoutGuard()

      // Rogue library banner or console.log write
      process.stdout.write('Loaded plugin: custom-tool\n')
      process.stdout.write('Warning: cache miss\n')

      expect(stdoutBuf.length).toBe(0)
      expect(stderrBuf.join('')).toBe('Loaded plugin: custom-tool\nWarning: cache miss\n')
    })

    it('diverts malformed JSON-shaped objects and arrays to stderr', () => {
      installStdoutGuard()

      process.stdout.write('{not valid json}\n')
      process.stdout.write('[1, 2, not_json]\n')
      process.stdout.write('{"unclosed": "string}\n')

      expect(stdoutBuf.length).toBe(0)
      expect(stderrBuf.join('')).toBe('{not valid json}\n[1, 2, not_json]\n{"unclosed": "string}\n')
    })

    it('restores original stdout writer cleanly when restoreStdout is called', () => {
      installStdoutGuard()
      restoreStdout()

      process.stdout.write('Plain text after restore\n')
      expect(stdoutBuf.join('')).toBe('Plain text after restore\n')
      expect(stderrBuf.length).toBe(0)
    })
  })

  describe('StderrLogger: silence by default, minimal single-line tree in debug mode', () => {
    let stderrBuf: string[] = []
    let origStderrWrite: typeof process.stderr.write

    beforeEach(() => {
      stderrBuf = []
      origStderrWrite = process.stderr.write
      process.stderr.write = ((chunk: any) => {
        stderrBuf.push(String(chunk))
        return true
      }) as any
    })

    afterEach(() => {
      process.stderr.write = origStderrWrite
    })

    it('default info level: completely silent for headers, footers, and tool events', () => {
      const logger = new StderrLogger('info', 0, 'auto', '/workspace')

      logger.header({
        model: 'google/gemini-2.5-flash',
        threadId: 'th_test_header',
        title: 'Test prompt',
        isNew: true,
        messageCount: 0,
        allowedCaps: ['default'],
        toolsList: ['ReadFile', 'Bash'],
      })
      logger.toolStart('ReadFile', 'src/main.ts', 'call_1')
      logger.toolEnd('read 15 lines', 25, false, 'call_1')
      logger.footer({
        status: 'completed',
        steps: 1,
        totalTokens: 100,
        durationMs: 500,
        threadId: 'th_test_header',
      })

      // Must be 100% silent
      expect(stderrBuf.length).toBe(0)
    })

    it('debug level (--verbose): emits clean single-line tree for tool execution', () => {
      const logger = new StderrLogger('debug', 0, 'auto', '/workspace')

      logger.toolStart('Bash', 'git status', 'call_2')
      logger.toolEnd('branch clean', 40, false, 'call_2', 'success')

      const output = stderrBuf.join('')
      expect(output).toContain('Bash git status\n')
      expect(output).toContain('⎿ ok (40ms): branch clean\n')
    })

    it('error and warning methods always output to stderr', () => {
      const logger = new StderrLogger('info', 0, 'auto', '/workspace')

      logger.error('Critical failure encountered')
      logger.warning('Rate limit approaching')

      const output = stderrBuf.join('')
      expect(output).toContain('error: Critical failure encountered\n')
      expect(output).toContain('warning: Rate limit approaching\n')
    })
  })

  describe('Color Palette: zero orange color invariant', () => {
    it('verifies dark and light theme primary colors have zero orange hue', () => {
      // In RGB: orange is roughly high red (>200), moderate green (80-160), low blue (<100)
      const isOrange = ([r, g, b]: [number, number, number]) =>
        r > 200 && g > 80 && g < 170 && b < 100

      expect(isOrange(DARK_THEME.primary)).toBe(false)
      expect(isOrange(LIGHT_THEME.primary)).toBe(false)

      // Primary colors must be cool blue/purple tones (blue component is significant)
      expect(DARK_THEME.primary[2]).toBeGreaterThan(200) // #b1b9f9
      expect(LIGHT_THEME.primary[2]).toBeGreaterThan(200) // #6a5acd

      // Primary and secondary colors must be distinct
      expect(DARK_THEME.primary).not.toEqual(DARK_THEME.secondary)
      expect(LIGHT_THEME.primary).not.toEqual(LIGHT_THEME.secondary)
      expect(ANSI_16_MAP.primary).not.toEqual(ANSI_16_MAP.secondary)

      // ANSI 16 primary is not 33 (yellow/orange)
      expect(ANSI_16_MAP.primary).not.toBe(33)
    })

    it('createColorFormatter produces clean styled output without throwing', () => {
      const fmt = createColorFormatter(3, 'dark')
      expect(fmt.bold('bold text')).toContain('bold text')
      expect(fmt.dim('dim text')).toContain('dim text')
      expect(fmt.error('error text')).toContain('error text')
    })
  })

  describe('TextSink & StreamJsonSink invariants', () => {
    let stdoutBuf: string[] = []
    let origStdoutWrite: typeof process.stdout.write

    beforeEach(() => {
      stdoutBuf = []
      origStdoutWrite = process.stdout.write
      process.stdout.write = ((chunk: any) => {
        stdoutBuf.push(String(chunk))
        return true
      }) as any
    })

    afterEach(() => {
      restoreStdout()
      process.stdout.write = origStdoutWrite
    })

    it('TextSink: streams raw chunks unbuffered and guarantees trailing newline', () => {
      const sink = new TextSink(false)

      sink.onEvent({ type: 'text-delta', delta: 'First line\n' })
      sink.onEvent({ type: 'text-delta', delta: 'Second line without newline' })
      expect(stdoutBuf.join('')).toBe('First line\nSecond line without newline')

      sink.finish({
        status: 'completed',
        exitCode: 0,
        text: 'First line\nSecond line without newline',
        stepsExecuted: 1,
      })

      // Must guarantee trailing newline on finish
      expect(stdoutBuf.join('')).toBe('First line\nSecond line without newline\n')
    })

    it('StreamJsonSink: truncates giant tool payloads (>64KB) without crashing', () => {
      const sink = new StreamJsonSink({
        threadId: 'th_giant_test',
        model: 'google/gemini-2.5-flash',
      })

      const giantText = 'x'.repeat(70_000)
      sink.onEvent({
        type: 'tool-call',
        toolName: 'Bash',
        callId: 'call_giant',
        input: { command: giantText },
      })

      const output = stdoutBuf.join('')
      const event = JSON.parse(output.trim())
      expect(event.type).toBe('tool-call')
      expect(event.tool).toBe('Bash')
      expect(event.truncated).toBe(true)
      expect(event.original_size).toBeGreaterThan(65536)
    })
  })
})
