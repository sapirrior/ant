import type { LogLevel } from '../types/config.ts'
import { formatDuration, formatTokens, style } from './format.ts'

const LOG_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  info: 1,
  debug: 2,
}

export class StderrLogger {
  constructor(private readonly level: LogLevel = 'info') {}

  private shouldLog(targetLevel: LogLevel): boolean {
    return LOG_PRIORITY[targetLevel] <= LOG_PRIORITY[this.level]
  }

  private prefix(): string {
    return style.dim('[ant]')
  }

  error(message: string): void {
    if (this.shouldLog('error')) {
      process.stderr.write(`${this.prefix()} ${style.red(style.bold('error:'))} ${message}\n`)
    }
  }

  info(message: string): void {
    if (this.shouldLog('info')) {
      process.stderr.write(`${this.prefix()} ${message}\n`)
    }
  }

  debug(message: string): void {
    if (this.shouldLog('debug')) {
      process.stderr.write(`${style.dim('[ant:debug]')} ${message}\n`)
    }
  }

  toolCall(toolName: string, inputSummary?: string): void {
    if (this.shouldLog('info')) {
      const summary = inputSummary ? ` ${style.dim(inputSummary)}` : ''
      process.stderr.write(`${this.prefix()} ${style.cyan('→')} ${toolName}${summary}\n`)
    }
  }

  toolResult(toolName: string, durationMs: number): void {
    if (this.shouldLog('info')) {
      const duration = style.dim(`(${formatDuration(durationMs)})`)
      process.stderr.write(`${this.prefix()} ${style.green('✓')} ${toolName} ${duration}\n`)
    }
  }

  completed(steps: number, totalTokens?: number): void {
    if (this.shouldLog('info')) {
      const tokenStr = totalTokens ? ` ${style.dim(`(${formatTokens(totalTokens)} tokens)`)}` : ''
      process.stderr.write(`${this.prefix()} ${style.green('✓')} completed in ${steps} step(s)${tokenStr}\n`)
    }
  }

  raw(chunk: string): void {
    process.stderr.write(chunk)
  }
}
