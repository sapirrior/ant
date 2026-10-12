import { describe, expect, it } from 'bun:test'
import { buildConfig, parseDurationMs } from './config.ts'
import { parseCliArgs } from './argv.ts'

describe('config', () => {
  it('parses duration strings properly', () => {
    expect(parseDurationMs('10s')).toBe(10000)
    expect(parseDurationMs('5m')).toBe(300000)
    expect(parseDurationMs('1h')).toBe(3600000)
    expect(parseDurationMs('500ms')).toBe(500)
    expect(parseDurationMs('1500')).toBe(1500)
  })

  it('builds config with default values', () => {
    const args = parseCliArgs(['-p', 'hello'])
    const cfg = buildConfig(args, undefined, {}, '/workspace', {})

    expect(cfg.prompt).toBe('hello')
    expect(cfg.model).toBe('anthropic/claude-3-7-sonnet-20250219')
    expect(cfg.maxSteps).toBe(30)
    expect(cfg.timeoutMs).toBe(1800000)
    expect(cfg.outputFormat).toBe('text')
    expect(cfg.logLevel).toBe('info')
    expect(cfg.continueLatest).toBe(false)
  })

  it('respects CLI flags over env vars and file config', () => {
    const args = parseCliArgs(['-p', 'task', '--model', 'google/gemini-2.5-flash', '--max-steps', '10'])
    const cfg = buildConfig(
      args,
      undefined,
      { ANT_MODEL: 'anthropic/claude-3-5-haiku-20241022', ANT_MAX_STEPS: '50' },
      '/workspace',
      { model: 'openrouter/openrouter/free', maxSteps: 20 }
    )

    expect(cfg.model).toBe('google/gemini-2.5-flash')
    expect(cfg.maxSteps).toBe(10)
  })

  it('rejects models with colons', () => {
    const args = parseCliArgs([])
    expect(() => buildConfig(args, undefined, { ANT_MODEL: 'anthropic:claude-3-5-sonnet' }, '/workspace', {})).toThrow(
      /Colons are not allowed/
    )
  })
})
