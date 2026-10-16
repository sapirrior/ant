import type { LogLevel } from '../core/types.ts'
import {
  createColorFormatter,
  formatDuration,
  formatTokens,
  getSymbols,
  type ColorLevel,
  type ThemeMode,
} from './color.ts'
import { displayPath } from './paths.ts'
import { collapseInline, visibleWidth } from '../utils/format.ts'

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
  private readonly sym: ReturnType<typeof getSymbols>
  readonly cwd: string
  private readonly activeCalls = new Map<string, ActiveCallInfo>()

  constructor(
    private readonly level: LogLevel = 'info',
    colorLevel?: ColorLevel,
    theme?: ThemeMode,
    cwd: string = process.cwd(),
  ) {
    this.fmt = createColorFormatter(colorLevel, theme)
    this.sym = getSymbols()
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

  header(options: HeaderOptions): void {
    if (!this.shouldLog('info')) return

    const providerStr = options.provider ? ` (${options.provider})` : ''
    const msgCountStr = options.isNew
      ? ''
      : options.messageCount !== undefined
        ? ` · ${options.messageCount} msg`
        : ''
    const capsStr = options.allowedCaps.length > 0 ? ` · [${options.allowedCaps.join(',')}]` : ''

    process.stderr.write(
      `${this.fmt.bold(options.model)}${this.fmt.muted(providerStr)} ${this.fmt.muted('·')} ${this.fmt.accent(options.threadId)}${this.fmt.muted(capsStr)}${this.fmt.muted(msgCountStr)}\n`,
    )

    if (options.modelMismatchOld) {
      process.stderr.write(
        `  ${this.fmt.warning(`note: model changed from ${options.modelMismatchOld}`)}\n`,
      )
    }

    if (options.toolsList && this.shouldLog('debug')) {
      process.stderr.write(`  ${this.fmt.muted(`tools: ${options.toolsList.join(', ')}`)}\n`)
    }
    process.stderr.write('\n')
  }

  toolStart(name: string, description: string = '', callId?: string): void {
    if (!this.shouldLog('info')) return

    if (callId) {
      // If there are already active tool calls, mark existing and new as parallel
      const isParallel = this.activeCalls.size > 0
      if (isParallel) {
        for (const info of this.activeCalls.values()) {
          info.isParallel = true
        }
      }
      this.activeCalls.set(callId, {
        toolName: name,
        target: description,
        isParallel,
      })
    }

    const cols = this.getStderrCols()
    // Prefix: symbol + space + name + space
    const fixedPrefixWidth =
      visibleWidth(this.sym.tool) + 1 + visibleWidth(name) + (description ? 1 : 0)
    const maxDescWidth = Math.max(0, cols - fixedPrefixWidth)
    const collapsedDesc = description ? collapseInline(description, maxDescWidth) : ''
    const descStr = collapsedDesc ? ` ${this.fmt.muted(collapsedDesc)}` : ''

    process.stderr.write(`${this.fmt.secondary(this.sym.tool)} ${this.fmt.bold(name)}${descStr}\n`)
  }

  toolEnd(
    summary: string,
    durationMs?: number,
    isError: boolean = false,
    callId?: string,
    severity?: OutcomeSeverity,
  ): void {
    if (!this.shouldLog('info')) return

    let isParallel = false
    let toolName = ''
    let target = ''
    if (callId && this.activeCalls.has(callId)) {
      const info = this.activeCalls.get(callId)!
      isParallel = info.isParallel
      toolName = info.toolName
      target = info.target
      this.activeCalls.delete(callId)
    }

    const durStr = durationMs !== undefined ? ` · ${formatDuration(durationMs)}` : ''
    const effSeverity = severity ?? (isError ? 'error' : 'success')
    const mark = effSeverity === 'error' ? this.sym.fail : this.sym.ok
    const markColored =
      effSeverity === 'error'
        ? this.fmt.error(mark)
        : effSeverity === 'warning'
          ? this.fmt.warning(mark)
          : this.fmt.success(mark)

    const cols = this.getStderrCols()
    const fixedPrefixWidth = 2 + visibleWidth(this.sym.result) + 1 + visibleWidth(mark) + 1 // '  ⎿ ✓ '
    const durWidth = visibleWidth(durStr)

    let lineBody = ''
    if (isParallel && toolName) {
      const disambig = target ? `${toolName} ${target}` : toolName
      const disambigClean = collapseInline(disambig, 30)
      const disambigWidth = visibleWidth(disambigClean) + 3 // ' ' + disambig + ' · '
      const maxSummaryWidth = Math.max(10, cols - fixedPrefixWidth - disambigWidth - durWidth)
      const boundedSummary = collapseInline(summary, maxSummaryWidth)
      const summaryColored =
        effSeverity === 'error'
          ? this.fmt.error(boundedSummary)
          : effSeverity === 'warning'
            ? this.fmt.warning(boundedSummary)
            : this.fmt.success(boundedSummary)
      lineBody = ` ${this.fmt.muted(disambigClean)} · ${summaryColored}${this.fmt.muted(durStr)}`
    } else {
      const maxSummaryWidth = Math.max(10, cols - fixedPrefixWidth - durWidth)
      const boundedSummary = collapseInline(summary, maxSummaryWidth)
      const summaryColored =
        effSeverity === 'error'
          ? this.fmt.error(boundedSummary)
          : effSeverity === 'warning'
            ? this.fmt.warning(boundedSummary)
            : this.fmt.success(boundedSummary)
      lineBody = ` ${summaryColored}${this.fmt.muted(durStr)}`
    }

    const fixedPrefix = `  ${this.fmt.muted(this.sym.result)} ${markColored}`
    process.stderr.write(`${fixedPrefix}${lineBody}\n`)
  }

  clearActiveCalls(): void {
    this.activeCalls.clear()
  }

  footer(options: FooterOptions): void {
    if (!this.shouldLog('info')) return

    this.clearActiveCalls()

    const ok = options.status === 'completed'
    const statusText = ok ? this.fmt.success('done') : this.fmt.error(options.status)
    const tokenStr = options.totalTokens ? ` · ${formatTokens(options.totalTokens)} tokens` : ''
    const durStr = ` · ${formatDuration(options.durationMs)}`

    if (ok) {
      process.stderr.write(`\n${statusText} · ${options.steps} step(s)${tokenStr}${durStr}\n`)
    } else {
      const cols = this.getStderrCols()
      const fixedWidth =
        visibleWidth(options.status) +
        2 +
        String(options.steps).length +
        9 +
        visibleWidth(durStr) +
        4
      const maxErrWidth = Math.max(10, cols - fixedWidth)
      const errReason = options.error ? `: ${collapseInline(options.error, maxErrWidth)}` : ''
      process.stderr.write(`\n${statusText}${errReason} · ${options.steps} step(s)${durStr}\n`)
    }

    if (options.threadId && options.threadId !== 'ephemeral') {
      const checkpointHint = options.hasCheckpoints ? ' · undo: ant checkpoints' : ''
      process.stderr.write(
        `${this.fmt.muted('resume:')} ant -r ${this.fmt.accent(options.threadId)}${this.fmt.muted(checkpointHint)}\n`,
      )
    }
  }
}
