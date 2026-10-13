import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { ProviderAdapter } from './types.ts'

export class CustomAdapter implements ProviderAdapter {
  readonly id = 'custom'
  readonly envVars = ['ANT_CUSTOM_BASE_URL', 'ANT_CUSTOM_API_KEY']

  validateAuth(env: NodeJS.ProcessEnv): void {
    if (!env.ANT_CUSTOM_BASE_URL) {
      throw new Error('Missing environment variable ANT_CUSTOM_BASE_URL for provider "custom".')
    }
  }

  createModel(modelId: string, env: NodeJS.ProcessEnv): LanguageModel {
    const baseURL = env.ANT_CUSTOM_BASE_URL!
    const apiKey = env.ANT_CUSTOM_API_KEY
    const providerInstance = createOpenAICompatible({
      name: 'custom',
      baseURL,
      apiKey,
    })
    return providerInstance(modelId)
  }
}

export const customAdapter = new CustomAdapter()
