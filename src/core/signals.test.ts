import { describe, expect, it } from 'bun:test'
import { abortReasonOf } from './signals.ts'

describe('signals and abort reason', () => {
  it('detects abort reason string passed to controller.abort()', () => {
    const c = new AbortController()
    c.abort('SIGINT')
    expect(abortReasonOf(c.signal)).toBe('SIGINT')
  })

  it('detects timeout, SIGTERM, SIGHUP', () => {
    const c1 = new AbortController()
    c1.abort('timeout')
    expect(abortReasonOf(c1.signal)).toBe('timeout')

    const c2 = new AbortController()
    c2.abort('SIGTERM')
    expect(abortReasonOf(c2.signal)).toBe('SIGTERM')

    const c3 = new AbortController()
    c3.abort('SIGHUP')
    expect(abortReasonOf(c3.signal)).toBe('SIGHUP')
  })

  it('returns undefined for non-standard reason or unaborted signal', () => {
    const c1 = new AbortController()
    expect(abortReasonOf(c1.signal)).toBeUndefined()

    const c2 = new AbortController()
    c2.abort('unknown-reason')
    expect(abortReasonOf(c2.signal)).toBeUndefined()
  })

  it('reproduces B2 bug: direct assignment to signal.reason throws TypeError', () => {
    const c = new AbortController()
    expect(() => {
      ;(c.signal as any).reason = 'SIGINT'
    }).toThrow()
  })
})
