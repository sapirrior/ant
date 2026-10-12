import { describe, expect, it } from 'bun:test'
import type { ModelMessage } from 'ai'
import { repairHistory } from './repair.ts'

describe('history repair on load (I3)', () => {
  it('returns empty array when messages are empty', () => {
    const { messages, repaired } = repairHistory([])
    expect(messages).toEqual([])
    expect(repaired).toEqual([])
  })

  it('repairs history ending in a user message by adding synthetic assistant message', () => {
    const input: ModelMessage[] = [
      { role: 'user', content: 'hello' },
    ]
    const { messages, repaired } = repairHistory(input)
    expect(messages.length).toBe(2)
    expect(messages[1]!.role).toBe('assistant')
    expect(repaired.length).toBe(1)
  })

  it('repairs orphan tool calls lacking tool results', () => {
    const input: ModelMessage[] = [
      { role: 'user', content: 'run tool' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'Bash', input: { command: 'ls' } },
        ],
      },
    ]
    const { messages, repaired } = repairHistory(input)
    expect(messages.length).toBe(3)
    expect(messages[2]!.role).toBe('tool')
    expect(repaired.some((r) => r.includes('orphan tool call'))).toBe(true)
  })

  it('is idempotent: running repair twice yields no new repairs', () => {
    const input: ModelMessage[] = [
      { role: 'user', content: 'test' },
    ]
    const first = repairHistory(input)
    const second = repairHistory(first.messages)
    expect(second.messages).toEqual(first.messages)
    expect(second.repaired).toEqual([])
  })
})
