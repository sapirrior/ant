import { fstatSync } from 'node:fs'

export const MAX_STDIN_BYTES = 10 * 1024 * 1024 // 10 MiB limit

export async function readPipedStdin(
  maxBytes: number = MAX_STDIN_BYTES,
  timeoutMs = process.env.ANT_STDIN_TIMEOUT
    ? Number.parseInt(process.env.ANT_STDIN_TIMEOUT, 10)
    : 0,
  signal?: AbortSignal,
  hardTimeoutMs?: number,
): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined
  }

  try {
    const stat = fstatSync(0)
    if (stat.isCharacterDevice()) {
      return undefined // e.g. /dev/null or terminal character device
    }
    if (!stat.isFIFO() && !stat.isFile() && !stat.isSocket()) {
      return undefined
    }
  } catch {
    return undefined
  }

  const chunks: Buffer[] = []
  let totalBytes = 0

  return new Promise<string | undefined>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let hardTimer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (hardTimer) clearTimeout(hardTimer)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('end', onEnd)
      process.stdin.removeListener('error', onError)
    }

    if (hardTimeoutMs && hardTimeoutMs > 0) {
      hardTimer = setTimeout(() => {
        cleanup()
        process.stdin.destroy()
        reject(new Error('timed out waiting for piped stdin'))
      }, hardTimeoutMs)
      hardTimer.unref()
    }

    const resetIdleTimer = () => {
      if (timer) clearTimeout(timer)
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup()
          process.stdin.destroy()
          if (chunks.length > 0) {
            process.stderr.write('warning: stdin truncated due to idle timeout\n')
            const content = Buffer.concat(chunks).toString('utf-8')
            resolve(content.trim().length === 0 ? undefined : content)
          } else {
            resolve(undefined)
          }
        }, timeoutMs)
        timer.unref()
      }
    }

    const onData = (chunk: Buffer | string) => {
      resetIdleTimer()
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buf.length
      if (totalBytes > maxBytes) {
        cleanup()
        process.stdin.destroy()
        reject(
          new Error(`Piped stdin exceeds the maximum allowed size of ${maxBytes} bytes (10 MiB).`),
        )
        return
      }
      chunks.push(buf)
    }

    const onEnd = () => {
      cleanup()
      if (chunks.length === 0 || totalBytes === 0) {
        resolve(undefined)
        return
      }
      const content = Buffer.concat(chunks).toString('utf-8')
      resolve(content.trim().length === 0 ? undefined : content)
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    if (signal) {
      if (signal.aborted) {
        resolve(undefined)
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          cleanup()
          resolve(undefined)
        },
        { once: true },
      )
    }

    resetIdleTimer()
    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
    process.stdin.on('error', onError)
    process.stdin.resume()
  })
}
