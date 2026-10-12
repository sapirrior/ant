import type { ModelMessage } from 'ai'

export interface RepairHistoryResult {
  messages: ModelMessage[]
  repaired: string[]
}

/**
 * Repairs conversation message history when resuming an interrupted or crashed session.
 *
 * Rules per Plan §2.6:
 * 1. Assistant message with tool-call parts and no following matching tool-result:
 *    append a tool message with error results for each orphan call.
 * 2. History ending in a user message: append a synthetic assistant marker
 *    so the new turn's user message alternates correctly with the assistant.
 * 3. Never deletes or rewrites existing history content.
 */
export function repairHistory(messages: readonly ModelMessage[]): RepairHistoryResult {
  const result: ModelMessage[] = [...messages]
  const repaired: string[] = []

  if (result.length === 0) {
    return { messages: result, repaired }
  }

  // Check Rule 1: Find tool-calls without matching tool-results
  const completedToolCallIds = new Set<string>()
  for (const msg of result) {
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && typeof part === 'object' && 'toolCallId' in part) {
          completedToolCallIds.add((part as { toolCallId: string }).toolCallId)
        }
      }
    }
  }

  // Look for any assistant messages with orphan tool calls
  const orphanToolCalls: { toolCallId: string; toolName: string }[] = []
  for (const msg of result) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && typeof part === 'object' && part.type === 'tool-call') {
          const call = part as { toolCallId: string; toolName: string }
          if (!completedToolCallIds.has(call.toolCallId)) {
            orphanToolCalls.push({
              toolCallId: call.toolCallId,
              toolName: call.toolName,
            })
          }
        }
      }
    }
  }

  if (orphanToolCalls.length > 0) {
    const syntheticToolMsg: ModelMessage = {
      role: 'tool',
      content: orphanToolCalls.map((orphan) => ({
        type: 'tool-result' as const,
        toolCallId: orphan.toolCallId,
        toolName: orphan.toolName,
        output: {
          type: 'json' as const,
          value: {
            ok: false,
            error: 'Tool execution was interrupted before completion.',
          },
        },
      })),
    }
    result.push(syntheticToolMsg)
    repaired.push(`repaired ${orphanToolCalls.length} orphan tool call(s) with error results`)
  }

  // Check Rule 2: History ending in user message
  const lastMsg = result[result.length - 1]
  if (lastMsg && lastMsg.role === 'user') {
    const syntheticAssistant: ModelMessage = {
      role: 'assistant',
      content: '[ant: previous turn was interrupted before response]',
    }
    result.push(syntheticAssistant)
    repaired.push('appended synthetic assistant marker for interrupted user turn')
  }

  return {
    messages: result,
    repaired,
  }
}
