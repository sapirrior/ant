import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { pidAlive } from './process.ts'

export async function withFileLock<T>(
  lockPath: string,
  fn: () => T | Promise<T>,
  options?: { maxWaitMs?: number; name?: string }
): Promise<T> {
  const maxWaitMs = options?.maxWaitMs ?? 5000
  const retryIntervalMs = 50
  const staleAgeMs = 30000
  const startTime = Date.now()
  const dir = dirname(lockPath)
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const token = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`
  let acquired = false

  while (true) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeFileSync(fd, `${token}\n${process.pid}\n${Date.now()}`, 'utf-8')
      closeSync(fd)
      acquired = true
      break
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'EEXIST') {
        try {
          const stats = statSync(lockPath)
          const age = Date.now() - stats.mtimeMs
          let isStale = age > staleAgeMs

          if (!isStale) {
            try {
              const content = readFileSync(lockPath, 'utf-8')
              const lines = content.trim().split('\n')
              const pid = lines[1] ? Number.parseInt(lines[1], 10) : 0
              if (pid > 0 && !pidAlive(pid)) {
                isStale = true
              }
            } catch {}
          }

          if (isStale) {
            const staleToken = `${lockPath}.stale.${token}`
            try {
              renameSync(lockPath, staleToken)
              unlinkSync(staleToken)
              continue
            } catch {
              // Another process handled the stale lock
            }
          }
        } catch {
          // Lock may have been released
        }

        if (Date.now() - startTime > maxWaitMs) {
          const name = options?.name ?? 'file'
          throw new Error(`Timeout waiting for ${name} lock (${lockPath}) after ${maxWaitMs}ms`)
        }
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs))
      } else {
        throw err
      }
    }
  }

  try {
    return await fn()
  } finally {
    if (acquired) {
      try {
        const content = readFileSync(lockPath, 'utf-8')
        if (content.startsWith(token)) {
          unlinkSync(lockPath)
        }
      } catch {}
    }
  }
}
