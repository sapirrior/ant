import { describe, expect, it } from 'bun:test'
import {
  anthropicAdapter,
  googleAdapter,
  openaiAdapter,
  groqAdapter,
  xaiAdapter,
  deepseekAdapter,
  ollamaAdapter,
  customAdapter,
  PROVIDER_ADAPTERS,
} from './index.ts'

describe('modular provider adapters', () => {
  it('registers all expected provider adapters', () => {
    const expected = [
      'anthropic',
      'google',
      'openai',
      'groq',
      'xai',
      'deepseek',
      'openrouter',
      'ollama',
      'custom',
    ]
    for (const p of expected) {
      expect(PROVIDER_ADAPTERS[p]).toBeDefined()
      expect(PROVIDER_ADAPTERS[p]!.id).toBe(p)
    }
  })

  it('anthropic adapter provides ephemeral prompt caching option', () => {
    expect(anthropicAdapter.buildProviderOptions?.()).toEqual({
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    })
  })

  it('google adapter provides relaxed safety settings for developer tasks', () => {
    expect(googleAdapter.buildProviderOptions?.()).toEqual({
      google: {
        safetySettings: [
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      },
    })
  })

  it('openai adapter only requires OPENAI_API_KEY', () => {
    expect(openaiAdapter.envVars).toEqual(['OPENAI_API_KEY'])
    expect(() => openaiAdapter.validateAuth({})).toThrow(/OPENAI_API_KEY/)
    expect(() => openaiAdapter.validateAuth({ OPENAI_API_KEY: 'test-key' })).not.toThrow()
  })

  it('groq adapter only requires GROQ_API_KEY', () => {
    expect(groqAdapter.envVars).toEqual(['GROQ_API_KEY'])
    expect(() => groqAdapter.validateAuth({})).toThrow(/GROQ_API_KEY/)
  })

  it('xai adapter only requires XAI_API_KEY', () => {
    expect(xaiAdapter.envVars).toEqual(['XAI_API_KEY'])
    expect(() => xaiAdapter.validateAuth({})).toThrow(/XAI_API_KEY/)
  })

  it('deepseek adapter only requires DEEPSEEK_API_KEY', () => {
    expect(deepseekAdapter.envVars).toEqual(['DEEPSEEK_API_KEY'])
    expect(() => deepseekAdapter.validateAuth({})).toThrow(/DEEPSEEK_API_KEY/)
  })

  it('ollama adapter allows no auth by default', () => {
    expect(() => ollamaAdapter.validateAuth({})).not.toThrow()
  })

  it('custom adapter requires ANT_CUSTOM_BASE_URL', () => {
    expect(() => customAdapter.validateAuth({})).toThrow(/ANT_CUSTOM_BASE_URL/)
    expect(() =>
      customAdapter.validateAuth({ ANT_CUSTOM_BASE_URL: 'http://localhost:8000/v1' }),
    ).not.toThrow()
  })
})
