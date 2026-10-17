import type { LogLevel } from '../core/types.ts'
import { createColorFormatter, formatDuration, type ColorLevel, type ThemeMode } from './color.ts'
import { displayPath } from './paths.ts'
import { collapseInline } from '../utils/format.ts'

const LOG_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  info: 1,
  debug: 2,
}

export interface HeaderOptions {
  model: string
  provider?: string
  threadId: string
  title: string
  isNew: boolean
  messageCount?: number
  allowedCaps: string[]
  modelMismatchOld?: string
  toolsList?: string[]
}

export interface FooterOptions {
  status: string
  steps: number
  totalTokens?: number
  durationMs: number
  threadId: string
  hasCheckpoints?: boolean
  error?: string
}

export type OutcomeSeverity = 'success' | 'warning' | 'error'

export interface ToolOutcomeResult {
  summary: string
  severity: OutcomeSeverity
}

export function formatToolTarget(toolName: string, input: unknown, cwd?: string): string {
  if (typeof input !== 'object' || input === null) {
    return ''
  }
  const obj = input as Record<string, unknown>

  switch (toolName) {
    case 'ReadFile': {
      const p = typeof obj.path === 'string' ? displayPath(obj.path, { cwd }) : ''
      if (typeof obj.offset === 'number' || typeof obj.limit === 'number') {
        const offset = typeof obj.offset === 'number' ? obj.offset : 1
        const limitStr = typeof obj.limit === 'number' ? `+${obj.limit}` : ''
        return `${p}:${offset}${limitStr}`
      }
      return p
    }

    case 'WriteFile':
    case 'EditFile':
    case 'DeleteFile':
    case 'ListDir': {
      return typeof obj.path === 'string' ? displayPath(obj.path, { cwd }) : ''
    }

    case 'Grep': {
      const pattern = typeof obj.pattern === 'string' ? `/${obj.pattern}/` : ''
      const p = typeof obj.path === 'string' && obj.path ? ` ${displayPath(obj.path, { cwd })}` : ''
      return `${pattern}${p}`.trim()
    }

    case 'Bash': {
      if (typeof obj.command === 'string') {
        return collapseInline(obj.command, 60)
      }
      return ''
    }

    case 'TaskManager': {
      const action = typeof obj.action === 'string' ? obj.action : ''
      const taskId = typeof obj.taskId === 'string' ? ` ${obj.taskId}` : ''
      return `${action}${taskId}`.trim()
    }

    case 'WebSearch': {
      if (typeof obj.query === 'string') {
        return collapseInline(obj.query, 60)
      }
      return ''
    }

    case 'WebFetch': {
      if (typeof obj.url === 'string') {
        return collapseInline(obj.url, 60)
      }
      return ''
    }

    case 'McpTool': {
      if (obj.action === 'call') {
        const server = typeof obj.server === 'string' ? obj.server : ''
        const tool = typeof obj.tool === 'string' ? obj.tool : ''
        return `${server}/${tool}`
      }
      return typeof obj.action === 'string' ? obj.action : ''
    }

    default: {
      if (typeof obj.path === 'string') return displayPath(obj.path, { cwd })
      if (typeof obj.command === 'string') return collapseInline(obj.command, 60)
      if (typeof obj.query === 'string') return collapseInline(obj.query, 60)
      if (typeof obj.url === 'string') return collapseInline(obj.url, 60)
      return ''
    }
  }
}

export function formatToolOutcome(
  toolName: string,
  rawOutput: unknown,
  isError?: boolean,
): ToolOutcomeResult {
  if (isError) {
    let errStr = 'failed'
    if (typeof rawOutput === 'string') {
      errStr = rawOutput
    } else if (rawOutput instanceof Error) {
      errStr = rawOutput.message
    } else if (typeof rawOutput === 'object' && rawOutput !== null) {
      const obj = rawOutput as Record<string, unknown>
      if (typeof obj.error === 'string') {
        errStr = obj.error
      } else if (typeof obj.message === 'string') {
        errStr = obj.message
      }
    }
    return {
      summary: collapseInline(errStr, 80) || 'failed',
      severity: 'error',
    }
  }

  // Unwrap exactly one known successful ToolExecutionResult wrapper { ok: true, output: payload }
  let payload = rawOutput
  if (
    typeof rawOutput === 'object' &&
    rawOutput !== null &&
    (rawOutput as Record<string, unknown>).ok === true &&
    'output' in (rawOutput as Record<string, unknown>)
  ) {
    payload = (rawOutput as Record<string, unknown>).output
  }

  if (payload === null || payload === undefined) {
    return { summary: 'done', severity: 'success' }
  }

  if (typeof payload !== 'object') {
    return {
      summary: collapseInline(String(payload), 80) || 'done',
      severity: 'success',
    }
  }

  const obj = payload as Record<string, unknown>

  switch (toolName) {
    case 'ReadFile': {
      const linesReturned = typeof obj.linesReturned === 'number' ? obj.linesReturned : undefined
      const totalLines = typeof obj.totalLines === 'number' ? obj.totalLines : undefined
      const truncated = obj.truncated ? ' (truncated)' : ''
      if (linesReturned !== undefined && totalLines !== undefined) {
        return {
          summary: `read ${linesReturned}/${totalLines} lines${truncated}`,
          severity: 'success',
        }
      }
      if (linesReturned !== undefined) {
        return {
          summary: `read ${linesReturned} lines${truncated}`,
          severity: 'success',
        }
      }
      return { summary: 'read done', severity: 'success' }
    }

    case 'WriteFile':
    case 'EditFile':
    case 'DeleteFile': {
      const status = typeof obj.status === 'string' ? obj.status : 'done'
      const cp = typeof obj.checkpoint === 'string' ? ` · checkpoint ${obj.checkpoint}` : ''
      return {
        summary: `${status}${cp}`,
        severity: 'success',
      }
    }

    case 'ListDir': {
      const count =
        typeof obj.count === 'number'
          ? obj.count
          : Array.isArray(obj.entries)
            ? obj.entries.length
            : undefined
      const total = typeof obj.totalEntries === 'number' ? obj.totalEntries : undefined
      const truncated = obj.truncated ? ' (truncated)' : ''
      if (count !== undefined && total !== undefined && count !== total) {
        return {
          summary: `${count}/${total} entries${truncated}`,
          severity: 'success',
        }
      }
      if (count !== undefined) {
        return {
          summary: `${count} entries${truncated}`,
          severity: 'success',
        }
      }
      return { summary: 'listed', severity: 'success' }
    }

    case 'Grep': {
      const matches = Array.isArray(obj.matches)
        ? obj.matches.length
        : typeof obj.totalMatches === 'number'
          ? obj.totalMatches
          : 0
      const truncated = obj.truncated ? ' (truncated)' : ''
      return {
        summary: `${matches} match(es)${truncated}`,
        severity: 'success',
      }
    }

    case 'Bash': {
      const status = obj.status
      if (status === 'running') {
        const taskId = typeof obj.taskId === 'string' ? obj.taskId : ''
        return {
          summary: `running in background as ${taskId}`.trim(),
          severity: 'success',
        }
      }
      if (status === 'timed_out') {
        return {
          summary: 'timed out',
          severity: 'warning',
        }
      }
      if (status === 'exited') {
        const exitCode = typeof obj.exitCode === 'number' ? obj.exitCode : 0
        return {
          summary: `exit ${exitCode}`,
          severity: exitCode === 0 ? 'success' : 'warning',
        }
      }
      return { summary: 'done', severity: 'success' }
    }

    case 'TaskManager': {
      if (Array.isArray(obj.tasks)) {
        return { summary: `${obj.tasks.length} task(s)`, severity: 'success' }
      }
      if (typeof obj.action === 'string') {
        if (obj.action === 'write') {
          return {
            summary: `sent ${Number(obj.bytesWritten ?? 0)} chars to stdin`,
            severity: 'success',
          }
        }
        if (obj.action === 'stop') {
          return { summary: `stopped task ${obj.taskId ?? ''}`.trim(), severity: 'success' }
        }
      }
      if (typeof obj.output === 'string') {
        const chars = obj.output.length
        const kb = (chars / 1024).toFixed(1)
        return {
          summary: `${kb} KB output · status: ${obj.status ?? 'unknown'}`,
          severity: 'success',
        }
      }
      return { summary: 'ok', severity: 'success' }
    }

    case 'WebSearch': {
      const total =
        typeof obj.totalResults === 'number'
          ? obj.totalResults
          : Array.isArray(obj.results)
            ? obj.results.length
            : undefined
      if (total !== undefined) {
        return { summary: `${total} result(s)`, severity: 'success' }
      }
      return { summary: 'searched', severity: 'success' }
    }

    case 'WebFetch': {
      if (typeof obj.title === 'string' && obj.title) {
        return { summary: collapseInline(obj.title, 50), severity: 'success' }
      }
      if (typeof obj.totalChunks === 'number') {
        return { summary: `fetched ${obj.totalChunks} chunk(s)`, severity: 'success' }
      }
      return { summary: 'fetched', severity: 'success' }
    }

    default: {
      return { summary: 'done', severity: 'success' }
    }
  }
}

interface ActiveCallInfo {
  toolName: string
  target: string
  isParallel: boolean
}

export class StderrLogger {
  private readonly fmt: ReturnType<typeof createColorFormatter>
  readonly cwd: string
  private readonly activeCalls = new Map<string, ActiveCallInfo>()

  constructor(
    private readonly level: LogLevel = 'info',
    colorLevel?: ColorLevel,
    theme?: ThemeMode,
    cwd: string = process.cwd(),
  ) {
    this.fmt = createColorFormatter(colorLevel, theme)
    this.cwd = cwd
  }

  private shouldLog(targetLevel: LogLevel): boolean {
    return LOG_PRIORITY[targetLevel] <= LOG_PRIORITY[this.level]
  }

  private getStderrCols(): number {
    const envCols = process.env.COLUMNS ? Number.parseInt(process.env.COLUMNS, 10) : NaN
    if (!Number.isNaN(envCols) && envCols > 0) {
      return Math.max(20, envCols)
    }
    const cols = process.stderr.columns || 80
    return Math.max(20, cols)
  }

  error(message: string): void {
    if (this.shouldLog('error')) {
      const cols = this.getStderrCols()
      const prefix = 'error: '
      const maxMsgWidth = Math.max(10, cols - prefix.length)
      const sanitized = collapseInline(message, maxMsgWidth)
      process.stderr.write(`${this.fmt.error('error:')} ${sanitized}\n`)
    }
  }

  warning(message: string): void {
    if (this.shouldLog('info')) {
      const cols = this.getStderrCols()
      const prefix = 'warning: '
      const maxMsgWidth = Math.max(10, cols - prefix.length)
      const sanitized = collapseInline(message, maxMsgWidth)
      process.stderr.write(`${this.fmt.warning('warning:')} ${sanitized}\n`)
    }
  }

  info(message: string): void {
    if (this.shouldLog('info')) {
      process.stderr.write(`${message}\n`)
    }
  }

  debug(message: string): void {
    if (this.shouldLog('debug')) {
      process.stderr.write(`${this.fmt.dim(message)}\n`)
    }
  }

  header(_options: HeaderOptions): void {
    // Print agent behavior: silent by default on stderr.
  }

  toolStart(name: string, description: string = '', callId?: string): void {
    if (!this.shouldLog('debug')) return

    if (callId) {
      this.activeCalls.set(callId, {
        toolName: name,
        target: description,
        isParallel: this.activeCalls.size > 0,
      })
    }

    const descStr = description ? ` ${this.fmt.muted(description)}` : ''
    process.stderr.write(`${this.fmt.bold(name)}${descStr}\n`)
  }

  toolEnd(
    summary: string,
    durationMs?: number,
    isError: boolean = false,
    callId?: string,
    severity?: OutcomeSeverity,
  ): void {
    if (callId) this.activeCalls.delete(callId)
    if (!this.shouldLog('debug')) return

    const durStr = durationMs !== undefined ? ` (${formatDuration(durationMs)})` : ''
    const effSeverity = severity ?? (isError ? 'error' : 'success')
    const mark = effSeverity === 'error' ? 'fail' : 'ok'

    process.stderr.write(`  ⎿ ${mark}${durStr}: ${summary}\n`)
  }

  clearActiveCalls(): void {
    this.activeCalls.clear()
  }

  footer(_options: FooterOptions): void {
    // Print agent behavior: silent on exit unless errors occurred
    this.clearActiveCalls()
  }
}
