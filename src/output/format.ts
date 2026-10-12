export const isColorSupported =
  Boolean(process.stderr.isTTY) && process.env.NO_COLOR === undefined

export const style = {
  dim: (text: string) => (isColorSupported ? `\x1b[2m${text}\x1b[0m` : text),
  bold: (text: string) => (isColorSupported ? `\x1b[1m${text}\x1b[0m` : text),
  cyan: (text: string) => (isColorSupported ? `\x1b[36m${text}\x1b[0m` : text),
  green: (text: string) => (isColorSupported ? `\x1b[32m${text}\x1b[0m` : text),
  yellow: (text: string) => (isColorSupported ? `\x1b[33m${text}\x1b[0m` : text),
  red: (text: string) => (isColorSupported ? `\x1b[31m${text}\x1b[0m` : text),
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTokens(count?: number): string {
  if (count === undefined) return '0'
  return count.toLocaleString('en-US')
}
