import { describe, expect, it } from 'bun:test'
import { parseModelString, resolveLanguageModel } from './registry.ts'

describe('model registry', () => {
  it('parses provider and model ID correctly', () => {
    expect(parseModelString('anthropic/claude-3-7-sonnet-20250219')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-3-7-sonnet-20250219',
    })
    expect(parseModelString('openrouter/anthropic/claude-3.7-sonnet')).toEqual({
      provider: 'openrouter',
      modelId: 'anthropic/claude-3.7-sonnet',
    })
  })

  it('rejects colons in model string', () => {
    expect(() => parseModelString('google:gemini-2.5-flash')).toThrow(/Colons are not allowed/)
  })

  it('throws when OpenRouter key is missing', () => {
    expect(() => resolveLanguageModel('openrouter/openrouter/free', {})).toThrow(/OPENROUTER_API_KEY/)
  })

  it('throws when custom base URL is missing', () => {
    expect(() => resolveLanguageModel('custom/my-model', {})).toThrow(/ANT_CUSTOM_BASE_URL/)
  })
})
