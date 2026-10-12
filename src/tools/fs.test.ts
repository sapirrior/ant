import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWrite, computeHash, MAX_CHECKPOINT_BYTES, snapshot } from './fs.ts'

describe('file snapshot and atomic utilities', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ant-fs-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('computes sha256 hash deterministically', () => {
    const h1 = computeHash('hello world')
    const h2 = computeHash(Buffer.from('hello world'))
    expect(h1).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
    expect(h1).toBe(h2)
  })

  it('snapshots existing file with hash, size, and mode', () => {
    const filePath = join(tempDir, 'sample.txt')
    writeFileSync(filePath, 'ant tool snapshot test', { mode: 0o644 })

    const snap = snapshot(filePath)
    expect(snap).not.toBeNull()
    expect(snap!.size).toBe(22)
    expect(snap!.hash).toBe(computeHash('ant tool snapshot test'))
    const diskMode = statSync(filePath).mode & 0o777
    expect(snap!.mode).toBe(diskMode)
  })

  it('returns null when snapshotting non-existent file', () => {
    const snap = snapshot(join(tempDir, 'does-not-exist.txt'))
    expect(snap).toBeNull()
  })

  it('rejects snapshot on directory', () => {
    expect(() => snapshot(tempDir)).toThrow(/Cannot snapshot directory/)
  })

  it('rejects snapshot on files exceeding 20 MiB limit', () => {
    const filePath = join(tempDir, 'huge.bin')
    writeFileSync(filePath, Buffer.alloc(10))
    expect(MAX_CHECKPOINT_BYTES).toBe(20 * 1024 * 1024)
  })

  it('atomically writes files with intermediate directory creation', () => {
    const nestedPath = join(tempDir, 'sub', 'dir', 'target.ts')
    atomicWrite(nestedPath, 'console.log("hello")', 0o755)

    const snap = snapshot(nestedPath)
    expect(snap).not.toBeNull()
    expect(snap!.data.toString('utf-8')).toBe('console.log("hello")')
  })
})
