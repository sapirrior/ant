import { describe, expect, it } from 'bun:test'
import { describeModelError, mapStatusToExitCode } from './agent.ts'
import { APICallError, RetryError } from 'ai'

describe('core/agent error description and status mapping (Phase 7)', () => {
  it('maps execution statuses to standard CLI exit codes accurately', () => {
    expect(mapStatusToExitCode('completed')).toBe(0)
    expect(mapStatusToExitCode('max_steps')).toBe(1)
    expect(mapStatusToExitCode('truncated')).toBe(1)
    expect(mapStatusToExitCode('empty_response')).toBe(1)
    expect(mapStatusToExitCode('usage_error')).toBe(2)
    expect(mapStatusToExitCode('model_error')).toBe(3)
    expect(mapStatusToExitCode('timeout')).toBe(4)
    expect(mapStatusToExitCode('internal_error')).toBe(5)
    expect(mapStatusToExitCode('cancelled')).toBe(130)
  })

  it('unwraps 401/403 APICallError with provider env var details', () => {
    const error = new APICallError({
      message: 'Unauthorized',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {},
      statusCode: 401,
      responseBody: '{"error":"invalid_api_key"}',
    })

    const msg = describeModelError(error, 'anthropic')
    expect(msg).toContain('authentication failed')
    expect(msg).toContain('ANTHROPIC_API_KEY')
  })

  it('unwraps 429 rate limit errors', () => {
    const error = new APICallError({
      message: 'Too many requests',
      url: 'https://api.openai.com',
      requestBodyValues: {},
      statusCode: 429,
      responseBody: 'Rate limit exceeded',
    })

    const msg = describeModelError(error, 'google')
    expect(msg).toContain('rate limited after retry attempts')
  })

  it('unwraps 400 context/token length errors into thread guidance', () => {
    const error = new APICallError({
      message: 'Context length exceeded',
      url: 'https://api.openai.com',
      requestBodyValues: {},
      statusCode: 400,
      responseBody: 'maximum context length is 128000 tokens',
    })

    const msg = describeModelError(error)
    expect(msg).toBe('context too long — start a new thread')
  })

  it('unwraps RetryError to the underlying cause', () => {
    const inner = new APICallError({
      message: 'Internal server error',
      url: 'https://api.openai.com',
      requestBodyValues: {},
      statusCode: 502,
      responseBody: 'Bad gateway',
    })
    const retryErr = new RetryError({
      message: 'Failed after 3 retries',
      reason: 'maxRetriesExceeded',
      errors: [inner],
    })

    const msg = describeModelError(retryErr)
    expect(msg).toContain('provider error 502')
  })

  it('identifies network socket and lookup errors', () => {
    const netErr = new Error('getaddrinfo ENOTFOUND api.anthropic.com') as any
    netErr.code = 'ENOTFOUND'

    const msg = describeModelError(netErr)
    expect(msg).toContain('network error: ENOTFOUND')
  })

  it('unwraps NoOutputGeneratedError into actionable guidance', () => {
    const noOutputErr = new Error('No output generated. Check the stream for errors.')
    const msg = describeModelError(noOutputErr)
    expect(msg).toContain('model returned no output')
    expect(msg).toContain('reasoning effort')
  })
})
