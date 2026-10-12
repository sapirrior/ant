import { describe, expect, it } from 'bun:test'
import { resolveGrants } from './grants.ts'

describe('resolveGrants', () => {
  it('grants nothing by default (default deny)', () => {
    const grants = resolveGrants({
      allowRead: false,
      allowEdit: false,
      allowBash: false,
      allowDestructiveBash: false,
    })
    expect(grants.has('fs.read')).toBe(false)
    expect(grants.has('fs.write')).toBe(false)
    expect(grants.has('shell.run')).toBe(false)
    expect(grants.has('shell.destructive')).toBe(false)
  })

  it('allow-edit grants both fs.read and fs.write', () => {
    const grants = resolveGrants({
      allowRead: false,
      allowEdit: true,
      allowBash: false,
      allowDestructiveBash: false,
    })
    expect(grants.has('fs.read')).toBe(true)
    expect(grants.has('fs.write')).toBe(true)
    expect(grants.has('shell.run')).toBe(false)
  })

  it('allow-destructive-bash grants both shell.run and shell.destructive', () => {
    const grants = resolveGrants({
      allowRead: false,
      allowEdit: false,
      allowBash: false,
      allowDestructiveBash: true,
    })
    expect(grants.has('shell.run')).toBe(true)
    expect(grants.has('shell.destructive')).toBe(true)
  })
})
