import { anthropic, createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'
import type { ProviderAdapter, ProviderOptions } from './types.ts'

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic'
  readonly envVars = ['ANTHROPIC_API_KEY']

  validateAuth(env: NodeJS.ProcessEnv): void {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('Missing environment variable ANTHROPIC_API_KEY for provider "anthropic".')
    }
  }

  createModel(modelId: string, env: NodeJS.ProcessEnv): LanguageModel {
    const apiKey = env.ANTHROPIC_API_KEY
    const providerInstance = apiKey ? createAnthropic({ apiKey }) : anthropic
    return providerInstance(modelId)
  }

  buildProviderOptions(): ProviderOptions {
    return {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    }
  }
}

export const anthropicAdapter = new AnthropicAdapter()
