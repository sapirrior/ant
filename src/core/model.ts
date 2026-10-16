import {
  PROVIDER_ADAPTERS,
  parseModelString,
  validateModelConfig,
  resolveLanguageModel as resolveModelInternal,
  type ModelResolution as CoreModelResolution,
} from './providers/index.ts'

export type ModelResolution = CoreModelResolution

export interface ProviderSpec {
  name: string
  env: string[]
  validateAuth(env: NodeJS.ProcessEnv): void
}

/**
 * Backwards-compatible map derived directly from the modular adapters
 */
export const PROVIDERS: Record<string, ProviderSpec> = Object.fromEntries(
  Object.entries(PROVIDER_ADAPTERS).map(([name, adapter]) => [
    name,
    {
      name: adapter.id,
      env: adapter.envVars,
      validateAuth: (env: NodeJS.ProcessEnv) => adapter.validateAuth(env),
    },
  ]),
)

export { parseModelString, validateModelConfig }

export function resolveLanguageModel(
  rawModel: string,
  env: NodeJS.ProcessEnv = process.env,
): ModelResolution {
  return resolveModelInternal(rawModel, env)
}
