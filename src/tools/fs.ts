import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export const MAX_CHECKPOINT_BYTES = 20 * 1024 * 1024 // 20 MiB

export interface FileSnapshot {
  hash: string
  size: number
  data: Buffer
  mode: number
}

export function computeHash(content: Buffer | string): string {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
  return createHash('sha256').update(buf).digest('hex')
}

export function snapshot(absPath: string): FileSnapshot | null {
  if (!existsSync(absPath)) {
    return null
  }

  const stat = statSync(absPath)
  if (stat.isDirectory()) {
    throw new Error(`Cannot snapshot directory: "${absPath}"`)
  }

  if (stat.size > MAX_CHECKPOINT_BYTES) {
    throw new Error(
      `File "${basename(absPath)}" (${stat.size} bytes) exceeds maximum snapshot limit of 20 MiB. Mutation refused.`
    )
  }

  const data = readFileSync(absPath)
  const hash = computeHash(data)
  const mode = stat.mode & 0o777

  return { hash, size: stat.size, data, mode }
}

export function atomicWrite(absPath: string, content: Buffer | string, mode?: number): void {
  const dir = dirname(absPath)
  mkdirSync(dir, { recursive: true })

  const tmpPath = join(dir, `.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`)
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
  const fileMode = mode ?? 0o644

  writeFileSync(tmpPath, buffer, { mode: fileMode })
  renameSync(tmpPath, absPath)
}
