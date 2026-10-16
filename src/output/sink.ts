import type { ModelOutcome, OutputFormat, RunEvent } from '../core/types.ts'
import type { ColorLevel, ThemeMode } from './color.ts'
import pkg from '../../package.json' with { type: 'json' }
import { StreamingMarkdownRenderer } from './markdown.ts'
import {
  ResultSchema,
  StreamResultEventSchema,
  type ResultEnvelope,
} from './schema.ts'

export interface OutputSinkOptions {
  format: OutputFormat
  isStdoutTTY: boolean
  threadId?: string
  checkpoints?: number[]
  model?: string
  effort?: string
  startTime?: number
  colorLevel?: ColorLevel
  theme?: ThemeMode
}

export interface OutputSink {
  onEvent(event: RunEvent): void
  finish(outcome: ModelOutcome, meta?: Partial<OutputSinkOptions>): void
  ensureLineStart?(): void
}

function truncatePayload(payload: unknown, maxChars = 65536): { data: unknown; truncated?: boolean; originalSize?: number } {
  if (payload === undefined || payload === null) {
    return { data: payload }
  }

  let serialized: string
  if (typeof payload === 'string') {
    serialized = payload
  } else if (payload instanceof Error) {
    return { data: { name: payload.name, message: payload.message } }
  } else {
    try {
      serialized = JSON.stringify(payload)
    } catch {
      serialized = String(payload)
    }
  }

  const chars = Array.from(serialized)
  if (chars.length <= maxChars) {
    return { data: payload }
  }

  return {
    data: chars.slice(0, maxChars).join('') + '... [truncated]',
    truncated: true,
    originalSize: chars.length,
  }
}

export function buildResultEnvelope(
  outcome: ModelOutcome,
  meta?: Partial<OutputSinkOptions>
): ResultEnvelope {
  const durationMs = meta?.startTime ? Date.now() - meta.startTime : 0
  const isError = outcome.status !== 'completed'
  const subtype = outcome.status === 'completed' ? 'success' : outcome.status

  const raw = {
    schema_version: 1,
    type: 'result' as const,
    subtype,
    is_error: isError,
    exit_code: outcome.exitCode,
    result: outcome.text || null,
    error: isError
      ? {
          code: outcome.status,
          message: outcome.error || `Execution ended with status: ${outcome.status}`,
        }
      : null,
    session_id: meta?.threadId && meta.threadId !== 'ephemeral' ? meta.threadId : null,
    num_turns: outcome.stepsExecuted ?? 0,
    duration_ms: durationMs,
    model: meta?.model ?? '',
    effort: meta?.effort ?? null,
    usage: outcome.usage
      ? {
          input_tokens: outcome.usage.inputTokens,
          output_tokens: outcome.usage.outputTokens,
          total_tokens: outcome.usage.totalTokens,
          cached_tokens: outcome.usage.cachedTokens ?? 0,
        }
      : null,
    checkpoints: meta?.checkpoints ?? [],
    warnings: [],
  }

  const parsed = ResultSchema.safeParse(raw)
  if (parsed.success) {
    return parsed.data
  }

  return {
    schema_version: 1,
    type: 'result' as const,
    subtype,
    is_error: isError,
    exit_code: outcome.exitCode,
    result: outcome.text || null,
    error: isError ? { code: outcome.status, message: outcome.error ?? '' } : null,
    session_id: meta?.threadId && meta.threadId !== 'ephemeral' ? meta.threadId : null,
    num_turns: outcome.stepsExecuted ?? 0,
    duration_ms: durationMs,
    model: meta?.model ?? '',
    effort: meta?.effort ?? null,
    usage: null,
    checkpoints: meta?.checkpoints ?? [],
    warnings: [`Schema validation warning: ${parsed.error.message}`],
  }
}

export class JsonSink implements OutputSink {
  private meta?: Partial<OutputSinkOptions>

  constructor(meta?: Partial<OutputSinkOptions>) {
    this.meta = meta
  }

  onEvent(_event: RunEvent): void {
    // Single JSON output only emits at the end
  }

  finish(outcome: ModelOutcome, meta?: Partial<OutputSinkOptions>): void {
    const combinedMeta = { ...this.meta, ...meta }
    const envelope = buildResultEnvelope(outcome, combinedMeta)
    // Emit single-line compact JSON to stdout per headless conventions
    process.stdout.write(JSON.stringify(envelope) + '\n')
  }
}

export class StreamJsonSink implements OutputSink {
  private seq = 0
  private meta?: Partial<OutputSinkOptions>

  constructor(meta?: Partial<OutputSinkOptions>) {
    this.meta = meta
  }

  private writeLine(eventData: Record<string, unknown>): void {
    const event = {
      schema_version: 1,
      seq: this.seq++,
      ts: new Date().toISOString(),
      ...eventData,
    }
    process.stdout.write(JSON.stringify(event) + '\n')
  }

  emitInit(initData: {
    threadId?: string
    model: string
    provider?: string
    cwd?: string
    effort?: string | null
    permissionMode?: string
    tools: string[]
    resumed?: boolean
    modelChangedFrom?: string | null
  }): void {
    this.writeLine({
      type: 'init',
      model: initData.model,
      permission_mode: initData.permissionMode ?? 'default',
      tools: initData.tools,
      session_id: initData.threadId && initData.threadId !== 'ephemeral' ? initData.threadId : null,
      ant_version: pkg.version,
    })
  }

  onEvent(event: RunEvent): void {
    switch (event.type) {
      case 'text-delta': {
        this.writeLine({
          type: 'text-delta',
          delta: event.delta,
        })
        break
      }
      case 'tool-call': {
        const { data, truncated, originalSize } = truncatePayload(event.input)
        this.writeLine({
          type: 'tool-call',
          call_id: event.callId,
          tool: event.toolName,
          input: data,
          truncated,
          original_size: originalSize,
        })
        break
      }
      case 'tool-result': {
        const { data, truncated, originalSize } = truncatePayload(event.output)
        this.writeLine({
          type: 'tool-result',
          call_id: event.callId,
          tool: event.toolName,
          output: data,
          duration_ms: event.durationMs,
          is_error: Boolean(event.isError),
          truncated,
          original_size: originalSize,
        })
        break
      }
    }
  }

  finish(outcome: ModelOutcome, meta?: Partial<OutputSinkOptions>): void {
    const combinedMeta = { ...this.meta, ...meta }
    const envelope = buildResultEnvelope(outcome, combinedMeta)
    const resultEvent = {
      seq: this.seq++,
      ts: new Date().toISOString(),
      ...envelope,
    }
    StreamResultEventSchema.parse(resultEvent)
    process.stdout.write(JSON.stringify(resultEvent) + '\n')
  }

  ensureLineStart(): void {}
}

export class TextSink implements OutputSink {
  private isTTY: boolean
  private atLineStart = true
  private hasContentSinceBoundary = false

  constructor(isTTY: boolean) {
    this.isTTY = isTTY
  }

  onEvent(event: RunEvent): void {
    if (this.isTTY && event.type === 'text-delta') {
      process.stdout.write(event.delta)
      this.atLineStart = event.delta.endsWith('\n')
      this.hasContentSinceBoundary = true
    }
  }

  ensureLineStart(): void {
    if (!this.hasContentSinceBoundary) return

    if (!this.atLineStart) {
      process.stdout.write('\n\n')
    } else {
      process.stdout.write('\n')
    }
    this.atLineStart = true
    this.hasContentSinceBoundary = false
  }

  finish(outcome: ModelOutcome): void {
    if (!this.isTTY) {
      if (outcome.text) {
        process.stdout.write(outcome.text + (outcome.text.endsWith('\n') ? '' : '\n'))
      }
    } else {
      if (!this.atLineStart) {
        process.stdout.write('\n')
        this.atLineStart = true
      }
    }
  }
}

export class MarkdownSink implements OutputSink {
  private isTTY: boolean
  private renderer: StreamingMarkdownRenderer
  private atLineStart = true
  private hasContentSinceBoundary = false

  constructor(isTTY: boolean, colorLevel?: ColorLevel, theme?: ThemeMode) {
    this.isTTY = isTTY
    this.renderer = new StreamingMarkdownRenderer({ colorLevel, theme })
  }

  ensureLineStart(): void {
    const flushed = this.renderer.flush()
    if (flushed) {
      process.stdout.write(flushed)
      this.atLineStart = flushed.endsWith('\n')
      this.hasContentSinceBoundary = true
    }

    if (!this.hasContentSinceBoundary) return

    if (!this.atLineStart) {
      process.stdout.write('\n\n')
    } else {
      process.stdout.write('\n')
    }
    this.atLineStart = true
    this.hasContentSinceBoundary = false
  }

  onEvent(event: RunEvent): void {
    if (this.isTTY && event.type === 'text-delta') {
      const rendered = this.renderer.append(event.delta)
      if (rendered) {
        process.stdout.write(rendered)
        this.atLineStart = rendered.endsWith('\n')
        this.hasContentSinceBoundary = true
      }
    }
  }

  finish(outcome: ModelOutcome): void {
    if (!this.isTTY) {
      if (outcome.text) {
        process.stdout.write(outcome.text + (outcome.text.endsWith('\n') ? '' : '\n'))
      }
    } else {
      const flushed = this.renderer.flush()
      if (flushed) {
        process.stdout.write(flushed)
        this.atLineStart = flushed.endsWith('\n')
      }
      if (!this.atLineStart) {
        process.stdout.write('\n')
        this.atLineStart = true
      }
    }
  }
}

export function createOutputSink(options: OutputSinkOptions): OutputSink {
  switch (options.format) {
    case 'json':
      return new JsonSink(options)
    case 'stream-json':
      return new StreamJsonSink(options)
    case 'md':
      return new MarkdownSink(options.isStdoutTTY, options.colorLevel, options.theme)
    case 'text':
    default:
      return new TextSink(options.isStdoutTTY)
  }
}
