import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { ProviderAdapter } from './types.ts'

export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1'

export class OllamaAdapter implements ProviderAdapter {
  readonly id = 'ollama'
  readonly envVars = ['OLLAMA_BASE_URL', 'OLLAMA_API_KEY']

  validateAuth(_env: NodeJS.ProcessEnv): void {
    // Local Ollama works with default base URL and no key, but allows custom url/key
  }

  createModel(modelId: string, env: NodeJS.ProcessEnv): LanguageModel {
    const baseURL = env.OLLAMA_BASE_URL || OLLAMA_DEFAULT_BASE_URL
    const apiKey = env.OLLAMA_API_KEY
    const providerInstance = createOpenAICompatible({
      name: 'ollama',
      baseURL,
      apiKey,
    })
    return providerInstance(modelId)
  }
}

export const ollamaAdapter = new OllamaAdapter()
