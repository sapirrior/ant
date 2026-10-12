import { fstatSync } from 'node:fs'

export const MAX_STDIN_BYTES = 10 * 1024 * 1024 // 10 MiB limit

export async function readPipedStdin(
  maxBytes: number = MAX_STDIN_BYTES,
  timeoutMs = Number.parseInt(process.env.ANT_STDIN_TIMEOUT ?? '5000', 10),
  signal?: AbortSignal
): Promise<string | undefined> {
  try {
    const stat = fstatSync(0)
    if (!stat.isFIFO() && !stat.isFile()) {
      return undefined
    }
  } catch {
    return undefined
  }

  const chunks: Buffer[] = []
  let totalBytes = 0

  const readPromise = (async () => {
    for await (const chunk of process.stdin) {
      if (signal?.aborted) break
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += bufferChunk.length
      if (totalBytes > maxBytes) {
        throw new Error(`Piped stdin exceeds the maximum allowed size of ${maxBytes} bytes (10 MiB).`)
      }
      chunks.push(bufferChunk)
    }
  })()

  // Guard against parent processes leaving stdin pipes open without sending EOF
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    if (timeoutMs > 0) {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
      timer.unref()
    }
  })

  try {
    const res = await Promise.race([readPromise.then(() => 'done' as const), timeoutPromise])
    if (res === 'timeout' && chunks.length === 0) {
      return undefined
    }
  } finally {
    if (timer) clearTimeout(timer)
  }

  if (chunks.length === 0 || totalBytes === 0) {
    return undefined
  }

  const content = Buffer.concat(chunks).toString('utf-8')
  return content.trim().length === 0 ? undefined : content
}
