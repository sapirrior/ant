import { openai, createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { ProviderAdapter } from './types.ts'

export class OpenAIAdapter implements ProviderAdapter {
  readonly id = 'openai'
  readonly envVars = ['OPENAI_API_KEY']

  validateAuth(env: NodeJS.ProcessEnv): void {
    if (!env.OPENAI_API_KEY) {
      throw new Error('Missing environment variable OPENAI_API_KEY for provider "openai".')
    }
  }

  createModel(modelId: string, env: NodeJS.ProcessEnv): LanguageModel {
    const apiKey = env.OPENAI_API_KEY
    const providerInstance = apiKey ? createOpenAI({ apiKey }) : openai
    return providerInstance(modelId)
  }
}

export const openaiAdapter = new OpenAIAdapter()
