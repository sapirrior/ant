import { deepseek, createDeepSeek } from '@ai-sdk/deepseek'
import type { LanguageModel } from 'ai'
import type { ProviderAdapter } from './types.ts'

export class DeepSeekAdapter implements ProviderAdapter {
  readonly id = 'deepseek'
  readonly envVars = ['DEEPSEEK_API_KEY']

  validateAuth(env: NodeJS.ProcessEnv): void {
    if (!env.DEEPSEEK_API_KEY) {
      throw new Error('Missing environment variable DEEPSEEK_API_KEY for provider "deepseek".')
    }
  }

  createModel(modelId: string, env: NodeJS.ProcessEnv): LanguageModel {
    const apiKey = env.DEEPSEEK_API_KEY
    const providerInstance = apiKey ? createDeepSeek({ apiKey }) : deepseek
    return providerInstance(modelId)
  }
}

export const deepseekAdapter = new DeepSeekAdapter()
