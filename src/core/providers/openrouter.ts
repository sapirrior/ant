import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { ProviderAdapter } from './types.ts'

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = 'openrouter'
  readonly envVars = ['OPENROUTER_API_KEY']

  validateAuth(env: NodeJS.ProcessEnv): void {
    if (!env.OPENROUTER_API_KEY) {
      throw new Error('Missing environment variable OPENROUTER_API_KEY for provider "openrouter".')
    }
  }

  createModel(modelId: string, env: NodeJS.ProcessEnv): LanguageModel {
    const apiKey = env.OPENROUTER_API_KEY!
    const providerInstance = createOpenAICompatible({
      name: 'openrouter',
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })
    return providerInstance(modelId)
  }
}

export const openrouterAdapter = new OpenRouterAdapter()
