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

  warning(message: string): void {
    if (this.shouldLog('info')) {
      process.stderr.write(`[ant] ${this.fmt.warning('warning:')} ${message}\n`)
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

    const providerStr = options.provider ? `  (${this.fmt.muted(options.provider)})` : ''
    process.stderr.write(`${this.fmt.primary(this.sym.brand)} Using ${this.fmt.primary(options.model)}${providerStr}\n`)

    const statusTag = options.isNew
      ? '· new'
      : `· continued (${options.messageCount ?? 0} messages)`
    process.stderr.write(
      `  Thread ${this.fmt.accent(options.threadId)}  ${this.fmt.muted(`"${options.title}"`)}  ${this.fmt.muted(statusTag)}\n`
    )

    if (options.modelMismatchOld) {
      process.stderr.write(`  ${this.fmt.warning(`warning: thread started with ${options.modelMismatchOld}`)}\n`)
    }

    const capsStr = options.allowedCaps.length > 0 ? options.allowedCaps.join(' ') : 'none'
    process.stderr.write(`  Allowed: ${this.fmt.text(capsStr)}\n`)

    if (options.toolsList && this.shouldLog('debug')) {
      process.stderr.write(`  ${this.fmt.dim(`Tools: ${options.toolsList.join(', ')}`)}\n`)
    }
    process.stderr.write('\n')
  }

  toolStart(name: string, description: string = ''): void {
    if (!this.shouldLog('info')) return
    const descStr = description ? ` ${this.fmt.muted(description)}` : ''
    process.stderr.write(`${this.fmt.secondary(this.sym.tool)} ${this.fmt.bold(name)}${descStr}\n`)
  }

  toolEnd(summary: string, durationMs?: number, isError: boolean = false): void {
    if (!this.shouldLog('info')) return
    const durStr = durationMs !== undefined ? ` · ${formatDuration(durationMs)}` : ''
    const summaryColored = isError ? this.fmt.error(summary) : this.fmt.success(summary)
    process.stderr.write(`  ${this.fmt.muted(this.sym.result)} ${summaryColored}${this.fmt.muted(durStr)}\n`)
  }

  footer(options: FooterOptions): void {
    if (!this.shouldLog('info')) return

    const ok = options.status === 'completed'
    const statusIcon = ok ? this.fmt.success(this.sym.ok) : this.fmt.error(this.sym.fail)
    const tokenStr = options.totalTokens ? ` · ${formatTokens(options.totalTokens)} tokens` : ''
    const durStr = ` · ${formatDuration(options.durationMs)}`

    if (ok) {
      process.stderr.write(
        `\n${statusIcon} Done · ${options.steps} steps${tokenStr}${durStr}\n`
      )
    } else {
      const errReason = options.error ? `: ${options.error}` : ''
      process.stderr.write(
        `\n${statusIcon} ${this.fmt.error(`${options.status}${errReason}`)} · ${options.steps} steps${durStr}\n`
      )
    }

    const checkpointHint = options.hasCheckpoints ? ' · undo edits: ant checkpoints' : ''
    process.stderr.write(
      `  Thread ${this.fmt.accent(options.threadId)} · resume: ant --continue${checkpointHint}\n`
    )
  }
}
