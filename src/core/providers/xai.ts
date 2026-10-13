import { xai, createXai } from '@ai-sdk/xai'
import type { LanguageModel } from 'ai'
import type { ProviderAdapter } from './types.ts'

export class XAIAdapter implements ProviderAdapter {
  readonly id = 'xai'
  readonly envVars = ['XAI_API_KEY']

  validateAuth(env: NodeJS.ProcessEnv): void {
    if (!env.XAI_API_KEY) {
      throw new Error('Missing environment variable XAI_API_KEY for provider "xai".')
    }
  }

  createModel(modelId: string, env: NodeJS.ProcessEnv): LanguageModel {
    const apiKey = env.XAI_API_KEY
    const providerInstance = apiKey ? createXai({ apiKey }) : xai
    return providerInstance(modelId)
  }
}

export const xaiAdapter = new XAIAdapter()
