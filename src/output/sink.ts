import type { ModelOutcome, OutputFormat, RunEvent } from '../core/types.ts'
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
}

export interface OutputSink {
  onEvent(event: RunEvent): void
  finish(outcome: ModelOutcome, meta?: Partial<OutputSinkOptions>): void
}

function truncatePayload(payload: unknown, maxChars = 65536): { data: unknown; truncated?: boolean } {
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

  if (serialized.length <= maxChars) {
    return { data: payload }
  }

  return {
    data: serialized.slice(0, maxChars) + '... [truncated]',
    truncated: true,
  }
}

export function buildResultEnvelope(
  outcome: ModelOutcome,
  meta?: Partial<OutputSinkOptions>
): ResultEnvelope {
  const durationMs = meta?.startTime ? Date.now() - meta.startTime : undefined
  const raw: Record<string, unknown> = {
    schemaVersion: 1,
    status: outcome.status,
    exitCode: outcome.exitCode,
    text: outcome.text ?? '',
    threadId: meta?.threadId,
    steps: outcome.stepsExecuted ?? 0,
    usage: outcome.usage ?? null,
    checkpoints: meta?.checkpoints ?? [],
    error: outcome.error ?? null,
    model: meta?.model ?? null,
    effort: meta?.effort ?? null,
    durationMs,
    warnings: [],
  }

  return ResultSchema.parse(raw)
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
      schemaVersion: 1,
      seq: this.seq++,
      ts: new Date().toISOString(),
      ...eventData,
    }
    process.stdout.write(JSON.stringify(event) + '\n')
  }

  emitInit(initData: {
    threadId: string
    model: string
    provider?: string
    cwd: string
    effort?: string | null
    grants: string[]
    tools: string[]
    resumed: boolean
  }): void {
    this.writeLine({
      type: 'init',
      ...initData,
      antVersion: pkg.version ?? '0.2.0',
    })
  }

  onEvent(event: RunEvent): void {
    switch (event.type) {
      case 'text-delta': {
        this.writeLine({
          type: 'text',
          delta: event.delta,
        })
        break
      }
      case 'tool-call': {
        const { data, truncated } = truncatePayload(event.input)
        this.writeLine({
          type: 'tool_call',
          callId: event.callId,
          name: event.toolName,
          input: data,
          truncated,
        })
        break
      }
      case 'tool-result': {
        const { data, truncated } = truncatePayload(event.output)
        const ok = !event.isError
        this.writeLine({
          type: 'tool_result',
          callId: event.callId,
          name: event.toolName,
          ok,
          error: event.isError ? (typeof event.output === 'string' ? event.output : 'Tool error') : null,
          durationMs: event.durationMs,
          output: data,
          truncated,
        })
        break
      }
      case 'step-finish': {
        this.writeLine({
          type: 'step',
          stepNumber: event.stepNumber,
          finishReason: event.finishReason,
          usage: event.usage,
        })
        break
      }
    }
  }

  finish(outcome: ModelOutcome, meta?: Partial<OutputSinkOptions>): void {
    const combinedMeta = { ...this.meta, ...meta }
    const envelope = buildResultEnvelope(outcome, combinedMeta)
    const resultEvent = {
      type: 'result',
      seq: this.seq++,
      ts: new Date().toISOString(),
      ...envelope,
    }
    StreamResultEventSchema.parse(resultEvent)
    process.stdout.write(JSON.stringify(resultEvent) + '\n')
  }
}

export class TextSink implements OutputSink {
  private isTTY: boolean
  private atLineStart = true

  constructor(isTTY: boolean) {
    this.isTTY = isTTY
  }

  onEvent(event: RunEvent): void {
    if (this.isTTY && event.type === 'text-delta') {
      process.stdout.write(event.delta)
      this.atLineStart = event.delta.endsWith('\n')
    }
  }

  finish(outcome: ModelOutcome): void {
    if (!this.isTTY) {
      if (outcome.text) {
        process.stdout.write(outcome.text + (outcome.text.endsWith('\n') ? '' : '\n'))
      }
    } else {
      if (!this.atLineStart) {
        process.stdout.write('\n')
      }
    }
  }
}

export class MarkdownSink implements OutputSink {
  private isTTY: boolean
  private renderer = new StreamingMarkdownRenderer()
  private atLineStart = true

  constructor(isTTY: boolean) {
    this.isTTY = isTTY
  }

  onEvent(event: RunEvent): void {
    if (this.isTTY && event.type === 'text-delta') {
      const rendered = this.renderer.append(event.delta)
      if (rendered) {
        process.stdout.write(rendered)
        this.atLineStart = rendered.endsWith('\n')
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
      return new MarkdownSink(options.isStdoutTTY)
    case 'text':
    default:
      return new TextSink(options.isStdoutTTY)
  }
}
