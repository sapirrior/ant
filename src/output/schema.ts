import { z } from 'zod'
import pkg from '../../package.json' with { type: 'json' }

export const SCHEMA_VERSION = 1

export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  cached_tokens: z.number().int().nonnegative().optional(),
})

export const ErrorDetailSchema = z.object({
  code: z.string(),
  message: z.string(),
})

export const ResultSchema = z.object({
  schema_version: z.number().int().default(SCHEMA_VERSION),
  type: z.literal('result').default('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  exit_code: z.number().int(),
  result: z.string().nullable().optional(),
  error: ErrorDetailSchema.nullable().optional(),
  session_id: z.string().nullable().optional(),
  num_turns: z.number().int().nonnegative().default(0),
  duration_ms: z.number().int().nonnegative().default(0),
  model: z.string().default(''),
  effort: z.string().nullable().optional(),
  usage: UsageSchema.nullable().optional(),
  checkpoints: z.array(z.number().int()).default([]),
  warnings: z.array(z.string()).default([]),
})

export type ResultEnvelope = z.infer<typeof ResultSchema>

// Stream events (NDJSON)
export const StreamBaseEventSchema = z.object({
  schema_version: z.number().int().default(SCHEMA_VERSION),
  seq: z.number().int().nonnegative(),
  ts: z.string(), // ISO 8601
})

export const StreamInitEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('init'),
  model: z.string(),
  permission_mode: z.string().default('default'),
  tools: z.array(z.string()),
  session_id: z.string().nullable().optional(),
  ant_version: z.string().default(pkg.version),
})

export const StreamTextDeltaEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('text-delta'),
  delta: z.string(),
})

export const StreamToolCallEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('tool-call'),
  call_id: z.string(),
  tool: z.string(),
  input: z.unknown(),
  truncated: z.boolean().optional(),
  original_size: z.number().int().optional(),
})

export const StreamToolResultEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('tool-result'),
  call_id: z.string(),
  tool: z.string(),
  output: z.unknown(),
  duration_ms: z.number().int().nonnegative(),
  is_error: z.boolean().default(false),
  truncated: z.boolean().optional(),
  original_size: z.number().int().optional(),
})

export const StreamWarningEventSchema = StreamBaseEventSchema.extend({
  type: z.literal('warning'),
  message: z.string(),
})

export const StreamResultEventSchema = ResultSchema.extend({
  seq: z.number().int().nonnegative(),
  ts: z.string(),
})

export const StreamEventSchema = z.discriminatedUnion('type', [
  StreamInitEventSchema,
  StreamTextDeltaEventSchema,
  StreamToolCallEventSchema,
  StreamToolResultEventSchema,
  StreamWarningEventSchema,
  StreamResultEventSchema,
])

export type StreamEvent = z.infer<typeof StreamEventSchema>
