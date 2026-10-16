import { describe, expect, it } from 'bun:test'
import { buildResultEnvelope, JsonSink, StreamJsonSink } from './sink.ts'
import { ResultSchema, StreamEventSchema } from './schema.ts'
import type { ModelOutcome } from '../core/types.ts'

describe('output sinks protocol and serialization', () => {
  it('builds schema-valid success result envelope', () => {
    const outcome: ModelOutcome = {
      status: 'completed',
      exitCode: 0,
      text: 'Analysis complete.',
      stepsExecuted: 2,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    }

    const envelope = buildResultEnvelope(outcome, {
      threadId: 'th_123',
      model: 'google/gemini-2.5-flash',
      startTime: Date.now() - 500,
      checkpoints: [1],
    })

    const validated = ResultSchema.parse(envelope)
    expect(validated.schema_version).toBe(1)
    expect(validated.type).toBe('result')
    expect(validated.subtype).toBe('success')
    expect(validated.is_error).toBe(false)
    expect(validated.exit_code).toBe(0)
    expect(validated.result).toBe('Analysis complete.')
    expect(validated.session_id).toBe('th_123')
    expect(validated.num_turns).toBe(2)
    expect(validated.usage?.total_tokens).toBe(150)
    expect(validated.checkpoints).toEqual([1])
  })

  it('builds schema-valid error result envelope for max_turns', () => {
    const outcome: ModelOutcome = {
      status: 'max_turns',
      exitCode: 1,
      text: 'Partial answer before limit',
      stepsExecuted: 5,
      error: 'Turn limit reached',
    }

    const envelope = buildResultEnvelope(outcome, {
      threadId: 'th_456',
      model: 'anthropic/claude-3-7-sonnet',
      startTime: Date.now() - 1200,
    })

    const validated = ResultSchema.parse(envelope)
    expect(validated.is_error).toBe(true)
    expect(validated.subtype).toBe('max_turns')
    expect(validated.exit_code).toBe(1)
    expect(validated.result).toBe('Partial answer before limit')
    expect(validated.error?.code).toBe('max_turns')
    expect(validated.error?.message).toBe('Turn limit reached')
  })

  it('streams valid NDJSON events in StreamJsonSink', () => {
    const writtenLines: string[] = []
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: any) => {
      writtenLines.push(String(chunk))
      return true
    }) as any

    try {
      const sink = new StreamJsonSink()
      sink.emitInit({
        model: 'openai/gpt-4o',
        permissionMode: 'acceptEdits',
        tools: ['ReadFile', 'EditFile'],
        threadId: 'th_test',
      })

      sink.onEvent({
        type: 'text-delta',
        delta: 'Hello world',
      })

      sink.onEvent({
        type: 'tool-call',
        callId: 'call_1',
        toolName: 'ReadFile',
        input: { path: 'file.txt' },
      })

      sink.onEvent({
        type: 'tool-result',
        callId: 'call_1',
        toolName: 'ReadFile',
        output: 'content',
        durationMs: 42,
        isError: false,
      })

      sink.finish({
        status: 'completed',
        exitCode: 0,
        text: 'Hello world',
        stepsExecuted: 1,
      })

      expect(writtenLines.length).toBe(5)

      // Validate every single line parses according to StreamEventSchema
      for (const line of writtenLines) {
        expect(line.endsWith('\n')).toBe(true)
        const parsed = JSON.parse(line.trim())
        expect(parsed.schema_version).toBe(1)
        expect(typeof parsed.seq).toBe('number')
        expect(typeof parsed.ts).toBe('string')
        StreamEventSchema.parse(parsed)
      }
    } finally {
      process.stdout.write = originalWrite
    }
  })

  it('emits a single compact JSON object in JsonSink', () => {
    let written = ''
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: any) => {
      written += String(chunk)
      return true
    }) as any

    try {
      const sink = new JsonSink({ threadId: 'th_single', model: 'deepseek/chat' })
      sink.finish({
        status: 'completed',
        exitCode: 0,
        text: 'Clean result',
        stepsExecuted: 1,
      })

      expect(written.endsWith('\n')).toBe(true)
      const parsed = JSON.parse(written.trim())
      expect(parsed.schema_version).toBe(1)
      expect(parsed.type).toBe('result')
      expect(parsed.result).toBe('Clean result')
      ResultSchema.parse(parsed)
    } finally {
      process.stdout.write = originalWrite
    }
  })
})
