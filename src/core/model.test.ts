import { describe, expect, it } from 'bun:test'
import { parseModelString, resolveLanguageModel } from './model.ts'

describe('model registry', () => {
  it('parses provider and model ID correctly', () => {
    expect(parseModelString('anthropic/sonnet-4-turbo')).toEqual({
      provider: 'anthropic',
      modelId: 'sonnet-4-turbo',
    })
    expect(parseModelString('openrouter/anthropic/sonnet-4')).toEqual({
      provider: 'openrouter',
      modelId: 'anthropic/sonnet-4',
    })
  })

  it('rejects provider without slash in model string', () => {
    expect(() => parseModelString('google:gemini-2.5-flash')).toThrow(/Expected "provider\/model-id"/)
  })

  it('allows model IDs with colons such as tags (B-029)', () => {
    const parsed = parseModelString('openrouter/deepseek/deepseek-r1:free')
    expect(parsed.provider).toBe('openrouter')
    expect(parsed.modelId).toBe('deepseek/deepseek-r1:free')
  })

  it('throws when Anthropic key is missing', () => {
    expect(() => resolveLanguageModel('anthropic/sonnet-4-turbo', {})).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('throws when Google key is missing', () => {
    expect(() => resolveLanguageModel('google/gemini-2.5-flash', {})).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/)
  })

  it('throws when OpenRouter key is missing', () => {
    expect(() => resolveLanguageModel('openrouter/openrouter/free', {})).toThrow(/OPENROUTER_API_KEY/)
  })

  it('throws when custom base URL is missing', () => {
    expect(() => resolveLanguageModel('custom/my-model', {})).toThrow(/ANT_CUSTOM_BASE_URL/)
  })

  it('throws when OpenAI key is missing', () => {
    expect(() => resolveLanguageModel('openai/gpt-4o', {})).toThrow(/OPENAI_API_KEY/)
  })

  it('throws when Groq key is missing', () => {
    expect(() => resolveLanguageModel('groq/llama-3.3-70b-versatile', {})).toThrow(/GROQ_API_KEY/)
  })

  it('throws when xAI key is missing', () => {
    expect(() => resolveLanguageModel('xai/grok-2-1212', {})).toThrow(/XAI_API_KEY/)
  })

  it('throws when DeepSeek key is missing', () => {
    expect(() => resolveLanguageModel('deepseek/deepseek-chat', {})).toThrow(/DEEPSEEK_API_KEY/)
  })

  it('resolves Ollama without API key', () => {
    const res = resolveLanguageModel('ollama/llama3', {})
    expect(res.provider).toBe('ollama')
    expect(res.modelId).toBe('llama3')
    expect(res.model).toBeDefined()
  })
})
