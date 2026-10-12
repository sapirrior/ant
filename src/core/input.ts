import { fstatSync } from 'node:fs'

export const MAX_STDIN_BYTES = 10 * 1024 * 1024 // 10 MiB limit

export async function readPipedStdin(
  maxBytes: number = MAX_STDIN_BYTES
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

  for await (const chunk of process.stdin) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bufferChunk.length
    if (totalBytes > maxBytes) {
      throw new Error(`Piped stdin exceeds the maximum allowed size of ${maxBytes} bytes (10 MiB).`)
    }
    chunks.push(bufferChunk)
  }

  if (chunks.length === 0 || totalBytes === 0) {
    return undefined
  }

  const content = Buffer.concat(chunks).toString('utf-8')
  return content.trim().length === 0 ? undefined : content
}
