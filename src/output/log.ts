import type { LogLevel } from '../core/types.ts'
import {
  createColorFormatter,
  formatDuration,
  formatTokens,
  getSymbols,
  type ColorLevel,
} from './color.ts'

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

export class StderrLogger {
  private readonly fmt: ReturnType<typeof createColorFormatter>
  private readonly sym: ReturnType<typeof getSymbols>

  constructor(
    private readonly level: LogLevel = 'info',
    colorLevel?: ColorLevel
  ) {
    this.fmt = createColorFormatter(colorLevel)
    this.sym = getSymbols()
  }

  private shouldLog(targetLevel: LogLevel): boolean {
    return LOG_PRIORITY[targetLevel] <= LOG_PRIORITY[this.level]
  }

  error(message: string): void {
    if (this.shouldLog('error')) {
      process.stderr.write(`[ant] ${this.fmt.error('error:')} ${message}\n`)
    }
  }

  info(message: string): void {
    if (this.shouldLog('info')) {
      process.stderr.write(`[ant] ${message}\n`)
    }
  }

  debug(message: string): void {
    if (this.shouldLog('debug')) {
      process.stderr.write(`${this.fmt.dim('[debug]')} ${message}\n`)
    }
  }

  header(options: HeaderOptions): void {
    if (!this.shouldLog('info')) return
    process.stderr.write(`${this.fmt.primary('ant')} (${this.fmt.bold(options.model)})\n\n`)
  }

  toolStart(name: string, description: string = ''): void {
    if (!this.shouldLog('info')) return
    const descStr = description ? ` ${this.fmt.muted(description)}` : ''
    process.stderr.write(`${this.fmt.secondary(this.sym.tool)} ${this.fmt.bold(name)}${descStr}\n`)
  }

  toolEnd(summary: string, durationMs?: number, isError: boolean = false): void {
    if (!this.shouldLog('info')) return
    const durStr = durationMs !== undefined ? ` · ${formatDuration(durationMs)}` : ''
    const summaryColored = isError ? this.fmt.error(summary) : this.fmt.muted(summary)
    process.stderr.write(`  ${this.fmt.muted(this.sym.result)} ${summaryColored}${this.fmt.muted(durStr)}\n`)
  }

  footer(options: FooterOptions): void {
    if (!this.shouldLog('info')) return

    const ok = options.status === 'completed'
    const statusIcon = ok ? this.fmt.success(this.sym.ok) : this.fmt.error(this.sym.fail)
    const tokenStr = options.totalTokens ? ` · ${formatTokens(options.totalTokens)} tokens` : ''
    const durStr = ` · ${formatDuration(options.durationMs)}`

    process.stderr.write(
      `\n${statusIcon} Done · ${options.steps} steps${tokenStr}${durStr}\n`
    )

    if (options.error) {
      process.stderr.write(`  ${this.fmt.error(options.error)}\n`)
    }
  }
}
