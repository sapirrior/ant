export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const remSec = (s % 60).toFixed(0)
  return `${m}m ${remSec}s`
}

export function formatTokens(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}m`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return `${count}`
}

export function formatTimeAgo(timestampMs: number): string {
  const diffSec = Math.floor((Date.now() - timestampMs) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDays = Math.floor(diffHour / 24)
  return `${diffDays}d ago`
}

/**
 * Returns terminal display column width of text using Bun.stringWidth.
 */
export function visibleWidth(text: string): number {
  return Bun.stringWidth(text)
}

/**
 * Pads the end of a string to a visible display column targetWidth.
 */
export function padEndVisible(text: string, targetWidth: number, padChar: string = ' '): string {
  const currentWidth = visibleWidth(text)
  if (currentWidth >= targetWidth) return text
  const charWidth = Math.max(1, visibleWidth(padChar))
  const needed = targetWidth - currentWidth
  const repeatCount = Math.floor(needed / charWidth)
  const remainder = needed % charWidth
  return text + padChar.repeat(repeatCount) + ' '.repeat(remainder)
}

/**
 * Pads the start of a string to a visible display column targetWidth.
 */
export function padStartVisible(text: string, targetWidth: number, padChar: string = ' '): string {
  const currentWidth = visibleWidth(text)
  if (currentWidth >= targetWidth) return text
  const charWidth = Math.max(1, visibleWidth(padChar))
  const needed = targetWidth - currentWidth
  const repeatCount = Math.floor(needed / charWidth)
  const remainder = needed % charWidth
  return ' '.repeat(remainder) + padChar.repeat(repeatCount) + text
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// Strips ANSI escape sequences and terminal control characters (C0, C1, DEL)
// eslint-disable-next-line no-control-regex
const CONTROL_OR_ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x00-\x1f\x7f-\x9f]/g

/**
 * Removes terminal control/ANSI sequences from untrusted text, collapses newlines
 * and repeated whitespace to one space, trims, then truncates safely on grapheme-cluster
 * boundaries by terminal display width.
 */
export function collapseInline(text: string, maxWidth: number, ellipsis: string = '…'): string {
  if (maxWidth <= 0) return ''
  // 1. Strip control / ANSI sequences
  const stripped = text.replace(CONTROL_OR_ANSI_RE, ' ')
  // 2. Collapse newlines and repeated whitespace to one space, and trim
  const singleLine = stripped.replace(/\s+/g, ' ').trim()
  if (!singleLine) return ''

  const totalWidth = visibleWidth(singleLine)
  if (totalWidth <= maxWidth) {
    return singleLine
  }

  const ellipsisWidth = visibleWidth(ellipsis)
  // If there's no room for the ellipsis, return the shortest safe prefix that fits in maxWidth
  const targetBudget = maxWidth >= ellipsisWidth ? maxWidth - ellipsisWidth : maxWidth
  const useEllipsis = maxWidth >= ellipsisWidth

  let accumulated = ''
  let accumulatedWidth = 0

  for (const { segment } of segmenter.segment(singleLine)) {
    const segWidth = visibleWidth(segment)
    if (accumulatedWidth + segWidth > targetBudget) {
      break
    }
    accumulated += segment
    accumulatedWidth += segWidth
  }

  return useEllipsis ? accumulated + ellipsis : accumulated
}

