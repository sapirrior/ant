import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface WriteAtomicJsonOptions {
  dirMode?: number
  fileMode?: number
}

export function writeAtomicJsonFile(
  filePath: string,
  data: unknown,
  options: WriteAtomicJsonOptions = {},
): void {
  const dirMode = options.dirMode ?? 0o700
  const fileMode = options.fileMode ?? 0o600
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true, mode: dirMode })

  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: fileMode })
    renameSync(tmpPath, filePath)
  } catch (err) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath)
      }
    } catch {}
    throw err
  }
}
