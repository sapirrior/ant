/**
 * Stdout guard for machine-readable modes (json, stream-json).
 *
 * When emitting JSON or line-delimited NDJSON events on stdout, any stray write
 * (e.g. from a third-party dependency console.log or unexpected library banner)
 * will break machine parsers (like jq or CI scripts).
 *
 * This guard intercepts process.stdout.write and diverts any non-JSON or stray
 * text lines directly to process.stderr, preserving clean stream separation.
 */

let isInstalled = false
let originalStdoutWrite: typeof process.stdout.write | null = null

export function installStdoutGuard(): void {
  if (isInstalled) return
  isInstalled = true
  originalStdoutWrite = process.stdout.write.bind(process.stdout)

  const stdout = process.stdout as unknown as { write: (chunk: any, ...args: any[]) => boolean }
  stdout.write = (chunk: any, ...args: any[]): boolean => {
    const str = typeof chunk === 'string' ? chunk : (chunk?.toString?.('utf-8') ?? '')
    const trimmed = str.trim()

    // Pass valid JSON objects/arrays directly through to stdout
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      return (originalStdoutWrite as any)(chunk, ...args)
    }

    // Divert stray non-JSON output (banners, console.log) to stderr
    return (process.stderr.write as any)(chunk, ...args)
  }
}

export function restoreStdout(): void {
  if (!isInstalled || !originalStdoutWrite) return
  ;(process.stdout as unknown as { write: typeof process.stdout.write }).write = originalStdoutWrite
  originalStdoutWrite = null
  isInstalled = false
}
