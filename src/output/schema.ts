import { z } from 'zod'
import pkg from '../../package.json' with { type: 'json' }

export const SCHEMA_VERSION = 1

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
})

export const ResultSchema = z.object({
  schemaVersion: z.number().int().default(SCHEMA_VERSION),
  status: z.enum([
    'completed',
    'max_steps',
    'truncated',
    'empty_response',
    'usage_error',
    'model_error',
    'timeout',
    'internal_error',
    'cancelled',
  ]),
  exitCode: z.number().int(),
  text: z.string(),
  threadId: z.string().optional(),
  steps: z.number().int().nonnegative().default(0),
  usage: UsageSchema.nullable().optional(),
  checkpoints: z.array(z.number().int()).default([]),
  error: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  interrupted: z
    .object({
      signal: z.string(),
    })
    .nullable()
    .optional(),
  warnings: z.array(z.string()).default([]),
})

export type ResultEnvelope = z.infer<typeof ResultSchema>

// Stream events (NDJSON)
export const StreamBaseEventSchema = z.object({
  schemaVersion: z.number().int().default(SCHEMA_VERSION),
  seq: z.number().int().nonnegative(),
  ts: z.string(), // ISO 8601
})

export const StreamInitEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('init'),
  threadId: z.string(),
  model: z.string(),
  provider: z.string().optional(),
  cwd: z.string(),
  effort: z.string().nullable().optional(),
  grants: z.array(z.string()),
  tools: z.array(z.string()),
  resumed: z.boolean(),
  antVersion: z.string().default(pkg.version),
  modelChangedFrom: z.string().nullable().optional(),
})

export const StreamTextEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('text'),
  delta: z.string(),
})

export const StreamToolCallEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('tool_call'),
  callId: z.string(),
  name: z.string(),
  input: z.unknown(),
  truncated: z.boolean().optional(),
})

export const StreamToolResultEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('tool_result'),
  callId: z.string(),
  name: z.string(),
  ok: z.boolean(),
  error: z.string().nullable().optional(),
  durationMs: z.number().int().nonnegative(),
  output: z.unknown(),
  truncated: z.boolean().optional(),
})

export const StreamStepEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('step'),
  stepNumber: z.number().int().positive(),
  finishReason: z.string(),
  usage: UsageSchema.optional(),
})

export const StreamWarningEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('warning'),
  message: z.string(),
  code: z.string().optional(),
})

export const StreamResultEventSchema = ResultSchema.extend({
  type: z.literal('result'),
  seq: z.number().int().nonnegative(),
  ts: z.string(),
})

export const StreamEventSchema = z.discriminatedUnion('type', [
  StreamInitEventSchema,
  StreamTextEventSchema,
  StreamToolCallEventSchema,
  StreamToolResultEventSchema,
  StreamStepEventSchema,
  StreamWarningEventSchema,
  StreamResultEventSchema,
])

export type StreamEvent = z.infer<typeof StreamEventSchema>
