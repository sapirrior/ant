import { groq, createGroq } from '@ai-sdk/groq'
import type { LanguageModel } from 'ai'
import type { ProviderAdapter } from './types.ts'

export class GroqAdapter implements ProviderAdapter {
  readonly id = 'groq'
  readonly envVars = ['GROQ_API_KEY']

  validateAuth(env: NodeJS.ProcessEnv): void {
    if (!env.GROQ_API_KEY) {
      throw new Error('Missing environment variable GROQ_API_KEY for provider "groq".')
    }
  }

  createModel(modelId: string, env: NodeJS.ProcessEnv): LanguageModel {
    const apiKey = env.GROQ_API_KEY
    const providerInstance = apiKey ? createGroq({ apiKey }) : groq
    return providerInstance(modelId)
  }
}

export const groqAdapter = new GroqAdapter()
