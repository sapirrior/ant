import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ERROR_SUBTYPES,
  PERMISSION_MODES,
  REASONING_EFFORTS,
  SCHEMA_VERSION,
} from '../src/constants/index.ts'

const ROOT = join(import.meta.dir, '..')
const SCHEMAS_DIR = join(ROOT, 'schemas')

export function buildSuccessResultJsonSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'AntSuccessResult',
    description:
      'Standard single-object JSON response emitted on stdout when ant completes successfully.',
    type: 'object',
    required: [
      'schema_version',
      'type',
      'subtype',
      'is_error',
      'exit_code',
      'result',
      'num_turns',
      'duration_ms',
      'model',
    ],
    properties: {
      schema_version: { type: 'integer', const: SCHEMA_VERSION },
      type: { type: 'string', const: 'result' },
      subtype: { type: 'string', const: 'success' },
      is_error: { type: 'boolean', const: false },
      exit_code: { type: 'integer', const: 0 },
      result: { type: ['string', 'null'], example: 'Explanation of the code...' },
      session_id: {
        type: ['string', 'null'],
        example: '0194eb47-a123-7bcd-8ef0-123456789abc',
      },
      num_turns: { type: 'integer', minimum: 0, example: 2 },
      duration_ms: { type: 'integer', minimum: 0, example: 1420 },
      model: { type: 'string', example: 'google/gemini-2.5-flash' },
      effort: {
        type: ['string', 'null'],
        enum: [...REASONING_EFFORTS, null],
      },
      usage: {
        type: ['object', 'null'],
        properties: {
          input_tokens: { type: 'integer', example: 320 },
          output_tokens: { type: 'integer', example: 85 },
          total_tokens: { type: 'integer', example: 405 },
          cached_tokens: { type: 'integer', example: 0 },
        },
      },
      checkpoints: {
        type: 'array',
        items: { type: 'integer' },
        example: [1, 2],
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
        example: [],
      },
    },
  }
}

export function buildErrorResultJsonSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'AntErrorResult',
    description:
      'Standard single-object JSON response emitted on stdout when ant run fails after startup.',
    type: 'object',
    required: [
      'schema_version',
      'type',
      'subtype',
      'is_error',
      'exit_code',
      'error',
      'num_turns',
      'duration_ms',
      'model',
    ],
    properties: {
      schema_version: { type: 'integer', const: SCHEMA_VERSION },
      type: { type: 'string', const: 'result' },
      subtype: {
        type: 'string',
        enum: [...ERROR_SUBTYPES],
        example: 'max_turns',
      },
      is_error: { type: 'boolean', const: true },
      exit_code: { type: 'integer', minimum: 1, example: 1 },
      result: {
        type: ['string', 'null'],
        example: 'Partial output generated before reaching turn limit',
      },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: 'max_turns' },
          message: { type: 'string', example: 'Agent reached maximum turns limit (5)' },
        },
      },
      session_id: {
        type: ['string', 'null'],
        example: '0194eb47-a123-7bcd-8ef0-123456789abc',
      },
      num_turns: { type: 'integer', minimum: 0, example: 5 },
      duration_ms: { type: 'integer', minimum: 0, example: 4510 },
      model: { type: 'string', example: 'anthropic/claude-3-7-sonnet-20250219' },
      effort: { type: ['string', 'null'] },
      usage: {
        type: ['object', 'null'],
        properties: {
          input_tokens: { type: 'integer' },
          output_tokens: { type: 'integer' },
          total_tokens: { type: 'integer' },
          cached_tokens: { type: 'integer' },
        },
      },
      checkpoints: {
        type: 'array',
        items: { type: 'integer' },
        example: [],
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
        example: [],
      },
    },
  }
}

export function buildStreamEventsJsonSchema(): Record<string, unknown> {
  const commonBase = {
    schema_version: { type: 'integer', const: SCHEMA_VERSION },
    seq: { type: 'integer', minimum: 0 },
    ts: { type: 'string', format: 'date-time' },
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'AntStreamJsonEvent',
    description:
      'Single NDJSON event emitted line-by-line on stdout during `stream-json` execution.',
    type: 'object',
    oneOf: [
      {
        title: 'StreamInitEvent',
        type: 'object',
        required: ['schema_version', 'seq', 'ts', 'type', 'model', 'permission_mode', 'tools'],
        properties: {
          ...commonBase,
          type: { type: 'string', const: 'init' },
          model: { type: 'string' },
          permission_mode: { type: 'string', enum: [...PERMISSION_MODES] },
          tools: {
            type: 'array',
            items: { type: 'string' },
          },
          session_id: { type: ['string', 'null'] },
          ant_version: { type: 'string' },
        },
      },
      {
        title: 'StreamTextDeltaEvent',
        type: 'object',
        required: ['schema_version', 'seq', 'ts', 'type', 'delta'],
        properties: {
          ...commonBase,
          type: { type: 'string', const: 'text-delta' },
          delta: { type: 'string' },
        },
      },
      {
        title: 'StreamToolCallEvent',
        type: 'object',
        required: ['schema_version', 'seq', 'ts', 'type', 'call_id', 'tool', 'input'],
        properties: {
          ...commonBase,
          type: { type: 'string', const: 'tool-call' },
          call_id: { type: 'string' },
          tool: { type: 'string' },
          input: {},
          truncated: { type: 'boolean' },
          original_size: { type: 'integer' },
        },
      },
      {
        title: 'StreamToolResultEvent',
        type: 'object',
        required: [
          'schema_version',
          'seq',
          'ts',
          'type',
          'call_id',
          'tool',
          'output',
          'duration_ms',
          'is_error',
        ],
        properties: {
          ...commonBase,
          type: { type: 'string', const: 'tool-result' },
          call_id: { type: 'string' },
          tool: { type: 'string' },
          output: {},
          duration_ms: { type: 'integer', minimum: 0 },
          is_error: { type: 'boolean' },
          truncated: { type: 'boolean' },
          original_size: { type: 'integer' },
        },
      },
      {
        title: 'StreamWarningEvent',
        type: 'object',
        required: ['schema_version', 'seq', 'ts', 'type', 'message'],
        properties: {
          ...commonBase,
          type: { type: 'string', const: 'warning' },
          message: { type: 'string' },
        },
      },
      {
        title: 'StreamResultEvent',
        type: 'object',
        required: [
          'schema_version',
          'seq',
          'ts',
          'type',
          'subtype',
          'is_error',
          'exit_code',
          'num_turns',
          'duration_ms',
          'model',
        ],
        properties: {
          ...commonBase,
          type: { type: 'string', const: 'result' },
          subtype: { type: 'string' },
          is_error: { type: 'boolean' },
          exit_code: { type: 'integer' },
          result: { type: ['string', 'null'] },
          error: {
            type: ['object', 'null'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
          session_id: { type: ['string', 'null'] },
          num_turns: { type: 'integer', minimum: 0 },
          duration_ms: { type: 'integer', minimum: 0 },
          model: { type: 'string' },
          effort: { type: ['string', 'null'] },
          usage: { type: ['object', 'null'] },
          checkpoints: { type: 'array', items: { type: 'integer' } },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
    ],
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false

  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }

  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)

  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false
    if (!deepEqual(objA[key], objB[key])) return false
  }

  return true
}

const targets = [
  { file: 'result.json', data: buildSuccessResultJsonSchema() },
  { file: 'result.error.json', data: buildErrorResultJsonSchema() },
  { file: 'stream-json.events.json', data: buildStreamEventsJsonSchema() },
]

const isCheckMode = process.argv.includes('--check')
let hasDrift = false

for (const target of targets) {
  const filePath = join(SCHEMAS_DIR, target.file)
  const formatted = JSON.stringify(target.data, null, 2) + '\n'

  if (isCheckMode) {
    try {
      const current = readFileSync(filePath, 'utf-8')
      const currentParsed = JSON.parse(current)
      if (!deepEqual(currentParsed, target.data)) {
        hasDrift = true
        console.error(
          `Schema drift detected in schemas/${target.file}: types, values, structure, or metadata do not match.`,
        )
      }
    } catch (err) {
      hasDrift = true
      console.error(`Missing or malformed schema file: ${target.file} (${String(err)})`)
      continue
    }
  } else {
    writeFileSync(filePath, formatted, 'utf-8')
    console.log(`Updated schemas/${target.file}`)
  }
}

if (isCheckMode && hasDrift) {
  process.exit(1)
}
