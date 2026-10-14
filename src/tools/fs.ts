import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
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

export function snapshotFromBuffer(buffer: Buffer, mode?: number): FileSnapshot {
  return {
    hash: computeHash(buffer),
    size: buffer.length,
    data: buffer,
    mode: (mode ?? 0o644) & 0o777,
  }
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

  const suffix = randomBytes(6).toString('hex')
  const tmpPath = join(dir, `.tmp.${Date.now()}.${suffix}`)
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
  const fileMode = (mode ?? 0o644) & 0o777

  let fd: number | null = null
  try {
    fd = openSync(tmpPath, 'wx', fileMode)
    writeSync(fd, buffer)
    fsyncSync(fd)
    fchmodSync(fd, fileMode)
    closeSync(fd)
    fd = null
    renameSync(tmpPath, absPath)
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {}
    }
    try {
      unlinkSync(tmpPath)
    } catch {}
    throw err
  }
}
