import { anthropic } from '@ai-sdk/anthropic'
import { createGoogle, google } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export interface ModelResolution {
  readonly provider: string
  readonly modelId: string
  readonly model: LanguageModel
}

export function parseModelString(rawModel: string): { provider: string; modelId: string } {
  if (rawModel.includes(':')) {
    throw new Error(`Invalid model format: "${rawModel}". Colons are not allowed. Use "provider/model-id" (e.g. "anthropic/claude-3-7-sonnet-20250219").`)
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

  switch (provider) {
    case 'anthropic': {
      const model = anthropic(modelId)
      return { provider, modelId, model }
    }

    case 'google': {
      const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY || env.GEMINI_API_KEY
      const googleProvider = apiKey ? createGoogle({ apiKey }) : google
      const model = googleProvider(modelId)
      return { provider, modelId, model }
    }

    case 'openrouter': {
      const apiKey = env.OPENROUTER_API_KEY
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY environment variable is required to use OpenRouter models.')
      }
      const openrouter = createOpenAICompatible({
        name: 'openrouter',
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      })
      const model = openrouter(modelId)
      return { provider, modelId, model }
    }

    case 'custom': {
      const baseURL = env.ANT_CUSTOM_BASE_URL
      if (!baseURL) {
        throw new Error('ANT_CUSTOM_BASE_URL environment variable is required to use custom OpenAI-compatible endpoints.')
      }
      const custom = createOpenAICompatible({
        name: 'custom',
        apiKey: env.ANT_CUSTOM_API_KEY ?? '',
        baseURL,
      })
      const model = custom(modelId)
      return { provider, modelId, model }
    }

    default:
      throw new Error(`Unsupported provider "${provider}". Supported: anthropic, google, openrouter, custom. Format: "provider/model-id"`)
  }
}
