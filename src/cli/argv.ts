import { parseArgs } from 'node:util'
import type { LogLevel, OutputFormat } from '../types/config.ts'

export interface ParsedCliArgs {
  readonly prompt?: string
  readonly allowRead: boolean
  readonly allowEdit: boolean
  readonly allowBash: boolean
  readonly allowDestructiveBash: boolean
  readonly model?: string
  readonly maxSteps?: number
  readonly timeout?: string
  readonly outputFormat?: OutputFormat
  readonly logLevel?: LogLevel
  readonly continueLatest: boolean
  readonly resumeThreadId?: string
  readonly help: boolean
  readonly version: boolean
  readonly positionals: readonly string[]
}

export function parseCliArgs(args: readonly string[] = process.argv.slice(2)): ParsedCliArgs {
  const optionsConfig = {
    prompt: {
      type: 'string',
      short: 'p',
    },
    'allow-read': {
      type: 'boolean',
      default: false,
    },
    'allow-edit': {
      type: 'boolean',
      default: false,
    },
    'allow-bash': {
      type: 'boolean',
      default: false,
    },
    'allow-destructive-bash': {
      type: 'boolean',
      default: false,
    },
    model: {
      type: 'string',
    },
    'max-steps': {
      type: 'string',
    },
    timeout: {
      type: 'string',
    },
    output: {
      type: 'string',
    },
    'log-level': {
      type: 'string',
    },
    continue: {
      type: 'boolean',
      default: false,
    },
    resume: {
      type: 'string',
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
    version: {
      type: 'boolean',
      short: 'v',
      default: false,
    },
  } as const

  const parsed = parseArgs({
    args: [...args],
    options: optionsConfig,
    allowPositionals: true,
    strict: true,
  })

  // Validate model format if passed: must use provider/model-id format
  if (parsed.values.model !== undefined) {
    if (parsed.values.model.includes(':')) {
      throw new Error(`Invalid model format: "${parsed.values.model}". Colons are not allowed. Use "provider/model-id" (e.g. "anthropic/claude-3-7-sonnet-20250219").`)
    }
    const slashIndex = parsed.values.model.indexOf('/')
    if (slashIndex <= 0 || slashIndex === parsed.values.model.length - 1) {
      throw new Error(`Invalid model format: "${parsed.values.model}". Must follow "provider/model-id" format (e.g. "anthropic/claude-3-7-sonnet-20250219").`)
    }
  }

  let outputFormat: OutputFormat | undefined
  if (parsed.values.output) {
    if (parsed.values.output === 'text' || parsed.values.output === 'md' || parsed.values.output === 'json') {
      outputFormat = parsed.values.output
    } else {
      throw new Error(`Invalid --output value: "${parsed.values.output}". Allowed: text, md, json`)
    }
  }

  let logLevel: LogLevel | undefined
  if (parsed.values['log-level']) {
    if (parsed.values['log-level'] === 'error' || parsed.values['log-level'] === 'info' || parsed.values['log-level'] === 'debug') {
      logLevel = parsed.values['log-level']
    } else {
      throw new Error(`Invalid --log-level value: "${parsed.values['log-level']}". Allowed: error, info, debug`)
    }
  }

  let maxSteps: number | undefined
  if (parsed.values['max-steps']) {
    const parsedNum = Number.parseInt(parsed.values['max-steps'], 10)
    if (Number.isNaN(parsedNum) || parsedNum <= 0) {
      throw new Error(`Invalid --max-steps value: "${parsed.values['max-steps']}". Must be a positive integer.`)
    }
    maxSteps = parsedNum
  }

  // Use first positional argument as prompt if -p is omitted
  const prompt = parsed.values.prompt ?? parsed.positionals[0]

  return {
    prompt,
    allowRead: Boolean(parsed.values['allow-read']),
    allowEdit: Boolean(parsed.values['allow-edit']),
    allowBash: Boolean(parsed.values['allow-bash']),
    allowDestructiveBash: Boolean(parsed.values['allow-destructive-bash']),
    model: parsed.values.model,
    maxSteps,
    timeout: parsed.values.timeout,
    outputFormat,
    logLevel,
    continueLatest: Boolean(parsed.values.continue),
    resumeThreadId: parsed.values.resume,
    help: Boolean(parsed.values.help),
    version: Boolean(parsed.values.version),
    positionals: parsed.positionals,
  }
}
