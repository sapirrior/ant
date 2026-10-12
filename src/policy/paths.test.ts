import { describe, expect, it } from 'bun:test'
import { resolveWithinRoot } from './paths.ts'

describe('resolveWithinRoot', () => {
  const root = '/workspace/project'

  it('resolves relative paths safely within root', () => {
    const resolved = resolveWithinRoot('src/index.ts', root)
    expect(resolved).toBe('/workspace/project/src/index.ts')
  })

  it('resolves dot-slash relative paths within root', () => {
    const resolved = resolveWithinRoot('./package.json', root)
    expect(resolved).toBe('/workspace/project/package.json')
  })

  it('allows root itself', () => {
    const resolved = resolveWithinRoot('.', root)
    expect(resolved).toBe('/workspace/project')
  })

  it('rejects directory traversal attempts with ../', () => {
    expect(() => resolveWithinRoot('../secret.txt', root)).toThrow(/Access denied/)
    expect(() => resolveWithinRoot('src/../../etc/passwd', root)).toThrow(/Access denied/)
  })

  it('rejects absolute paths outside root', () => {
    expect(() => resolveWithinRoot('/etc/passwd', root)).toThrow(/Access denied/)
  })
})
