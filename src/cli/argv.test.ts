import { describe, expect, it } from 'bun:test'
import { parseCliArgs } from './argv.ts'

describe('parseCliArgs', () => {
  it('parses flags and aliases correctly with provider/model format', () => {
    const res = parseCliArgs(['-p', 'fix code', '--allow-read', '--model', 'google/gemini-2.5-flash'])
    expect(res.prompt).toBe('fix code')
    expect(res.allowRead).toBe(true)
    expect(res.allowEdit).toBe(false)
    expect(res.model).toBe('google/gemini-2.5-flash')
  })

  it('rejects models containing colons', () => {
    expect(() => parseCliArgs(['--model', 'google:gemini-2.5-flash'])).toThrow(/Colons are not allowed/)
  })

  it('rejects models without a provider slash', () => {
    expect(() => parseCliArgs(['--model', 'claude-3-7-sonnet'])).toThrow(/Must follow "provider\/model-id" format/)
  })

  it('parses --continue and --resume correctly', () => {
    const resContinue = parseCliArgs(['--continue'])
    expect(resContinue.continueLatest).toBe(true)

    const resResume = parseCliArgs(['--resume', 'thread_123'])
    expect(resResume.resumeThreadId).toBe('thread_123')
  })

  it('treats first positional as prompt when -p is not provided', () => {
    const res = parseCliArgs(['run tests', '--allow-bash'])
    expect(res.prompt).toBe('run tests')
    expect(res.allowBash).toBe(true)
  })

  it('throws on unknown flags due to strict mode', () => {
    expect(() => parseCliArgs(['--unknown-flag'])).toThrow()
  })
})
