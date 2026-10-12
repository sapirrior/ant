import { anthropic, createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle, google } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export interface ModelResolution {
  readonly provider: string
  readonly modelId: string
  readonly model: LanguageModel
}

export interface ProviderSpec {
  name: string
  env: string[]
  validateAuth(env: NodeJS.ProcessEnv): void
}

export const PROVIDERS: Record<string, ProviderSpec> = {
  anthropic: {
    name: 'anthropic',
    env: ['ANTHROPIC_API_KEY'],
    validateAuth(env) {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error('Missing environment variable ANTHROPIC_API_KEY for provider "anthropic".')
      }
    },
  },
  google: {
    name: 'google',
    env: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
    validateAuth(env) {
      if (!env.GOOGLE_GENERATIVE_AI_API_KEY && !env.GEMINI_API_KEY) {
        throw new Error('Missing environment variable GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY for provider "google".')
      }
    },
  },
  openrouter: {
    name: 'openrouter',
    env: ['OPENROUTER_API_KEY'],
    validateAuth(env) {
      if (!env.OPENROUTER_API_KEY) {
        throw new Error('Missing environment variable OPENROUTER_API_KEY for provider "openrouter".')
      }
    },
  },
  custom: {
    name: 'custom',
    env: ['ANT_CUSTOM_BASE_URL'],
    validateAuth(env) {
      if (!env.ANT_CUSTOM_BASE_URL) {
        throw new Error('Missing environment variable ANT_CUSTOM_BASE_URL for provider "custom".')
      }
    },
  },
}

export function parseModelString(rawModel: string): { provider: string; modelId: string } {
  if (rawModel.includes(':')) {
    throw new Error(`Invalid model format: "${rawModel}". Colons are not allowed. Use "provider/model-id" (e.g. "anthropic/model-name").`)
  }

  const slashIdx = rawModel.indexOf('/')
  if (slashIdx <= 0 || slashIdx === rawModel.length - 1) {
    throw new Error(`Invalid model format: "${rawModel}". Expected "provider/model-id" (e.g. "anthropic/claude-3-7-sonnet-20250219").`)
  }

  const provider = rawModel.slice(0, slashIdx).trim().toLowerCase()
  const modelId = rawModel.slice(slashIdx + 1).trim()

  return { provider, modelId }
}

export function resolveLanguageModel(rawModel: string, env: NodeJS.ProcessEnv = process.env): ModelResolution {
  const { provider, modelId } = parseModelString(rawModel)
  const spec = PROVIDERS[provider]

  if (!spec) {
    throw new Error(`Unsupported provider "${provider}". Supported: anthropic, google, openrouter, custom. Format: "provider/model-id"`)
  }

  spec.validateAuth(env)

  switch (provider) {
    case 'anthropic': {
      const apiKey = env.ANTHROPIC_API_KEY
      const providerInstance = apiKey ? createAnthropic({ apiKey }) : anthropic
      const model = providerInstance(modelId)
      return { provider, modelId, model }
    }

    case 'google': {
      const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY || env.GEMINI_API_KEY
      const googleProvider = apiKey ? createGoogle({ apiKey }) : google
      const model = googleProvider(modelId)
      return { provider, modelId, model }
    }

    case 'openrouter': {
      const apiKey = env.OPENROUTER_API_KEY!
      const openrouter = createOpenAICompatible({
        name: 'openrouter',
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      })
      const model = openrouter(modelId)
      return { provider, modelId, model }
    }

    case 'custom': {
      const baseURL = env.ANT_CUSTOM_BASE_URL!
      const custom = createOpenAICompatible({
        name: 'custom',
        apiKey: env.ANT_CUSTOM_API_KEY ?? '',
        baseURL,
      })
      const model = custom(modelId)
      return { provider, modelId, model }
    }

    default:
      throw new Error(`Unsupported provider "${provider}"`)
  }
}
