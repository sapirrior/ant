import { describe, expect, it } from 'bun:test'
import { createLifecycle } from './lifecycle.ts'

describe('lifecycle module', () => {
  it('creates an active lifecycle with AbortSignal', () => {
    const lc = createLifecycle()
    expect(lc.signal.aborted).toBe(false)
    lc.dispose()
  })

  it('allows registering and unregistering cleanup handlers', () => {
    const lc = createLifecycle()
    let called = false
    const unregister = lc.onEmergencyCleanup(() => {
      called = true
    })
    expect(called).toBe(false)
    unregister()
    lc.dispose()
  })

  it('cleans up handlers on dispose without error', () => {
    const lc = createLifecycle()
    expect(() => lc.dispose()).not.toThrow()
    expect(() => lc.dispose()).not.toThrow()
  })
})
