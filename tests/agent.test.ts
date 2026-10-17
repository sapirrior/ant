import { describe, expect, it } from 'bun:test'
import {
  describeModelError,
  mapStatusToExitCode,
  exitCodeForAbort,
  abortOutcome,
} from '../src/core/agent.ts'
import {
  parseModelString,
  validateModelConfig,
  resolveLanguageModel,
  PROVIDER_ADAPTERS,
} from '../src/core/providers/index.ts'
import { abortReasonOf } from '../src/core/signals.ts'
import { createLifecycle } from '../src/core/lifecycle.ts'
import { APICallError, RetryError } from 'ai'

describe('agent subsystem (core, models, signals, lifecycle)', () => {
  describe('model parsing and configuration validation', () => {
    it('parses provider and modelId correctly', () => {
      expect(parseModelString('anthropic/sonnet-4-turbo')).toEqual({
        provider: 'anthropic',
        modelId: 'sonnet-4-turbo',
      })
      expect(parseModelString('openrouter/anthropic/sonnet-4')).toEqual({
        provider: 'openrouter',
        modelId: 'anthropic/sonnet-4',
      })
      expect(parseModelString('openrouter/deepseek/deepseek-r1:free')).toEqual({
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-r1:free',
      })
    })

    it('rejects malformed model strings lacking provider slash', () => {
      expect(() => parseModelString('google:gemini-2.5-flash')).toThrow(
        /Expected "provider\/model-id"/,
      )
      expect(() => parseModelString('/gemini')).toThrow(/Expected "provider\/model-id"/)
      expect(() => parseModelString('anthropic/')).toThrow(/Expected "provider\/model-id"/)
    })

    it('rejects unsupported providers', () => {
      expect(() => validateModelConfig('unsupported_foo/bar', {})).toThrow(
        /Unsupported provider "unsupported_foo"/,
      )
    })

    it('enforces required authentication per provider without live network calls', () => {
      expect(() => resolveLanguageModel('anthropic/claude-3-7-sonnet', {})).toThrow(
        /ANTHROPIC_API_KEY/,
      )
      expect(() => resolveLanguageModel('google/gemini-2.5-flash', {})).toThrow(
        /GOOGLE_GENERATIVE_AI_API_KEY/,
      )
      expect(() => resolveLanguageModel('openai/gpt-4o', {})).toThrow(/OPENAI_API_KEY/)
      expect(() => resolveLanguageModel('groq/llama-3.3-70b', {})).toThrow(/GROQ_API_KEY/)
      expect(() => resolveLanguageModel('xai/grok-2', {})).toThrow(/XAI_API_KEY/)
      expect(() => resolveLanguageModel('deepseek/deepseek-chat', {})).toThrow(/DEEPSEEK_API_KEY/)
      expect(() => resolveLanguageModel('openrouter/meta-llama/llama-3', {})).toThrow(
        /OPENROUTER_API_KEY/,
      )
      expect(() => resolveLanguageModel('custom/my-model', {})).toThrow(/ANT_CUSTOM_BASE_URL/)

      // Ollama does not require mandatory auth keys to run
      expect(() => PROVIDER_ADAPTERS.ollama?.validateAuth({})).not.toThrow()
    })
  })

  describe('signals and abort handling', () => {
    it('detects abort reason string and resolves accurate exit codes', () => {
      const c1 = new AbortController()
      c1.abort('timeout')
      expect(abortReasonOf(c1.signal)).toBe('timeout')
      expect(exitCodeForAbort('timeout')).toBe(4)

      const c2 = new AbortController()
      c2.abort('SIGINT')
      expect(abortReasonOf(c2.signal)).toBe('SIGINT')
      expect(exitCodeForAbort('SIGINT')).toBe(130)

      const c3 = new AbortController()
      c3.abort('SIGTERM')
      expect(abortReasonOf(c3.signal)).toBe('SIGTERM')
      expect(exitCodeForAbort('SIGTERM')).toBe(143)

      const c4 = new AbortController()
      c4.abort('SIGHUP')
      expect(abortReasonOf(c4.signal)).toBe('SIGHUP')
      expect(exitCodeForAbort('SIGHUP')).toBe(129)

      const c5 = new AbortController()
      expect(abortReasonOf(c5.signal)).toBeUndefined()
    })

    it('builds abort outcome preserving steps executed and partial text', () => {
      const c = new AbortController()
      c.abort('timeout')
      const outcome = abortOutcome(c.signal, 3, 'partial output before timeout')
      expect(outcome.status).toBe('timeout')
      expect(outcome.exitCode).toBe(4)
      expect(outcome.stepsExecuted).toBe(3)
      expect(outcome.text).toBe('partial output before timeout')
      expect(outcome.error).toBe('Execution timed out.')
    })
  })

  describe('execution status and error mapping', () => {
    it('maps execution statuses to standard CLI exit codes', () => {
      expect(mapStatusToExitCode('completed')).toBe(0)
      expect(mapStatusToExitCode('max_turns')).toBe(1)
      expect(mapStatusToExitCode('truncated')).toBe(1)
      expect(mapStatusToExitCode('empty_response')).toBe(1)
      expect(mapStatusToExitCode('usage_error')).toBe(2)
      expect(mapStatusToExitCode('model_error')).toBe(3)
      expect(mapStatusToExitCode('timeout')).toBe(4)
      expect(mapStatusToExitCode('internal_error')).toBe(5)
      expect(mapStatusToExitCode('cancelled')).toBe(130)
    })

    it('unwraps provider APICallErrors, rate limits, and context length limits', () => {
      const authErr = new APICallError({
        message: 'Unauthorized',
        url: 'https://api.anthropic.com/v1/messages',
        requestBodyValues: {},
        statusCode: 401,
        responseBody: '{"error":"invalid_api_key"}',
      })
      expect(describeModelError(authErr, 'anthropic')).toContain('authentication failed')

      const rateLimitErr = new APICallError({
        message: 'Too many requests',
        url: 'https://api.openai.com',
        requestBodyValues: {},
        statusCode: 429,
        responseBody: 'Rate limit exceeded',
      })
      expect(describeModelError(rateLimitErr)).toContain('rate limited after retry attempts')

      const contextErr = new APICallError({
        message: 'Context length exceeded',
        url: 'https://api.openai.com',
        requestBodyValues: {},
        statusCode: 400,
        responseBody: 'maximum context length is 128000 tokens',
      })
      expect(describeModelError(contextErr)).toBe('context too long — start a new thread')

      const serverErr = new APICallError({
        message: 'Internal server error',
        url: 'https://api.openai.com',
        requestBodyValues: {},
        statusCode: 502,
        responseBody: 'Bad gateway',
      })
      const retryErr = new RetryError({
        message: 'Failed after 3 retries',
        reason: 'maxRetriesExceeded',
        errors: [serverErr],
      })
      expect(describeModelError(retryErr)).toContain('provider error 502')

      const netErr = new Error('getaddrinfo ENOTFOUND api.anthropic.com') as any
      netErr.code = 'ENOTFOUND'
      expect(describeModelError(netErr)).toContain('network error: ENOTFOUND')
    })
  })

  describe('lifecycle management', () => {
    it('manages abort signal and cleanup registration cleanly', () => {
      const lc = createLifecycle()
      expect(lc.signal.aborted).toBe(false)

      let cleaned = false
      const unregister = lc.onEmergencyCleanup(() => {
        cleaned = true
      })
      expect(cleaned).toBe(false)
      unregister()

      expect(() => lc.dispose()).not.toThrow()
      expect(() => lc.dispose()).not.toThrow()
    })
  })
})
