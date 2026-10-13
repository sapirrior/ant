import type { LanguageModel } from 'ai'
import type { SharedV4ProviderOptions } from '@ai-sdk/provider'

export type ProviderOptions = SharedV4ProviderOptions

export interface ProviderAdapter {
  readonly id: string
  readonly envVars: string[]
  validateAuth(env: NodeJS.ProcessEnv): void
  createModel(modelId: string, env: NodeJS.ProcessEnv): LanguageModel
  buildProviderOptions?(): ProviderOptions
}

export interface ModelResolution {
  readonly provider: string
  readonly modelId: string
  readonly model: LanguageModel
  readonly adapter: ProviderAdapter
}
