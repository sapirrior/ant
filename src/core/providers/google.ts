import { google, createGoogle } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { ProviderAdapter, ProviderOptions } from './types.ts'

export class GoogleAdapter implements ProviderAdapter {
  readonly id = 'google'
  readonly envVars = ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY']

  validateAuth(env: NodeJS.ProcessEnv): void {
    if (!env.GOOGLE_GENERATIVE_AI_API_KEY && !env.GEMINI_API_KEY) {
      throw new Error(
        'Missing environment variable GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY for provider "google".',
      )
    }
  }

  createModel(modelId: string, env: NodeJS.ProcessEnv): LanguageModel {
    const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY || env.GEMINI_API_KEY
    const providerInstance = apiKey ? createGoogle({ apiKey }) : google
    return providerInstance(modelId)
  }

  buildProviderOptions(): ProviderOptions {
    // Relaxed safety threshold so code reading, system tools, and bash analysis
    // don't trigger false-positive consumer HARM_CATEGORY blocks during coding sessions
    return {
      google: {
        safetySettings: [
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      },
    }
  }
}

export const googleAdapter = new GoogleAdapter()
