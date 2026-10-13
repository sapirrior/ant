import type { ProviderAdapter, ModelResolution } from './types.ts'
import { anthropicAdapter } from './anthropic.ts'
import { googleAdapter } from './google.ts'
import { openaiAdapter } from './openai.ts'
import { groqAdapter } from './groq.ts'
import { xaiAdapter } from './xai.ts'
import { deepseekAdapter } from './deepseek.ts'
import { openrouterAdapter } from './openrouter.ts'
import { ollamaAdapter } from './ollama.ts'
import { customAdapter } from './custom.ts'

export const PROVIDER_ADAPTERS: Record<string, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  google: googleAdapter,
  openai: openaiAdapter,
  groq: groqAdapter,
  xai: xaiAdapter,
  deepseek: deepseekAdapter,
  openrouter: openrouterAdapter,
  ollama: ollamaAdapter,
  custom: customAdapter,
}

export function parseModelString(rawModel: string): { provider: string; modelId: string } {
  const slashIdx = rawModel.indexOf('/')
  if (slashIdx <= 0 || slashIdx === rawModel.length - 1) {
    throw new Error(
      `Invalid model format: "${rawModel}". Expected "provider/model-id" (e.g. "anthropic/claude-3-7-sonnet-20250219").`
    )
  }

  const provider = rawModel.slice(0, slashIdx).trim().toLowerCase()
  const modelId = rawModel.slice(slashIdx + 1).trim()

  return { provider, modelId }
}

export function resolveLanguageModel(
  rawModel: string,
  env: NodeJS.ProcessEnv = process.env
): ModelResolution {
  const { provider, modelId } = parseModelString(rawModel)
  const adapter = PROVIDER_ADAPTERS[provider]

  if (!adapter) {
    const supportedList = Object.keys(PROVIDER_ADAPTERS).join(', ')
    throw new Error(`Unsupported provider "${provider}". Supported: ${supportedList}. Format: "provider/model-id"`)
  }

  adapter.validateAuth(env)
  const model = adapter.createModel(modelId, env)

  return { provider, modelId, model, adapter }
}
