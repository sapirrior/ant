/**
 * The single, dedicated writer for stdout.
 * Emits final output cleanly for shell pipes and redirects.
 */
export function writeStdout(content: string): void {
  if (content.length === 0) {
    return
  }

  process.stdout.write(content.endsWith('\n') ? content : `${content}\n`)
}
