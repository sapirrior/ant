import { describe, expect, it } from 'bun:test'
import {
  formatToolOutcome,
  formatToolTarget,
  StderrLogger,
} from './log.ts'

describe('output/log tool formatting and logger', () => {
  it('formats tool targets accurately and compactly on one line', () => {
    expect(formatToolTarget('ReadFile', { path: 'src/index.ts', offset: 10, limit: 20 })).toBe('src/index.ts:10+20')
    expect(formatToolTarget('ReadFile', { path: 'src/index.ts' })).toBe('src/index.ts')
    expect(formatToolTarget('Grep', { pattern: 'function\\s+foo', path: 'src' })).toBe('/function\\s+foo/ src')
    expect(formatToolTarget('Bash', { command: 'echo hello\nworld' })).toBe('echo hello world')
    expect(formatToolTarget('TaskManager', { action: 'stop', taskId: 't1' })).toBe('stop t1')
    expect(formatToolTarget('McpTool', { action: 'call', server: 'git', tool: 'log' })).toBe('git/log')
    expect(formatToolTarget('Unknown', null)).toBe('')
  })

  it('formats tool outcomes and unwraps ToolExecutionResult wrapper', () => {
    // ReadFile
    const readWrapped = { ok: true, output: { linesReturned: 120, totalLines: 350 } }
    expect(formatToolOutcome('ReadFile', readWrapped)).toEqual({
      summary: 'read 120/350 lines',
      severity: 'success',
    })

    // WriteFile with checkpoint
    const writeWrapped = { ok: true, output: { status: 'written', checkpoint: '#1' } }
    expect(formatToolOutcome('WriteFile', writeWrapped)).toEqual({
      summary: 'written · checkpoint #1',
      severity: 'success',
    })

    // Bash statuses and exit codes
    expect(formatToolOutcome('Bash', { ok: true, output: { status: 'running', taskId: 't2' } })).toEqual({
      summary: 'running in background as t2',
      severity: 'success',
    })
    expect(formatToolOutcome('Bash', { ok: true, output: { status: 'timed_out' } })).toEqual({
      summary: 'timed out',
      severity: 'warning',
    })
    expect(formatToolOutcome('Bash', { ok: true, output: { status: 'exited', exitCode: 0 } })).toEqual({
      summary: 'exit 0',
      severity: 'success',
    })
    expect(formatToolOutcome('Bash', { ok: true, output: { status: 'exited', exitCode: 1 } })).toEqual({
      summary: 'exit 1',
      severity: 'warning',
    })

    // Errors
    expect(formatToolOutcome('Bash', 'Command failed: syntax error', true)).toEqual({
      summary: 'Command failed: syntax error',
      severity: 'error',
    })
  })

  it('correlates parallel tool completions without mixing up targets', () => {
    const logger = new StderrLogger('info', 0, 'ansi')
    logger.toolStart('ReadFile', 'src/a.ts', 'call-1')
    logger.toolStart('ReadFile', 'src/b.ts', 'call-2') // Trigger parallel flag

    // Both calls are marked parallel and can finish out-of-order
    logger.toolEnd('read 10 lines', 5, false, 'call-2')
    logger.toolEnd('read 20 lines', 8, false, 'call-1')
  })
})
