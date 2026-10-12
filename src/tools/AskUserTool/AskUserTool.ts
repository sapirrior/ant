import { createInterface } from 'node:readline/promises'
import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { ASK_USER_DESCRIPTION } from './prompt.ts'

export const askUserInputSchema = z.object({
  question: z.string().describe('The clarifying question to ask the user.'),
})

export function createAskUserTool(context: ToolExecutionContext) {
  return tool({
    description: ASK_USER_DESCRIPTION,
    inputSchema: askUserInputSchema,
    execute: async (input) => {
      return executeWithPolicy('AskUser', input, context, async ({ question }) => {
        // Non-interactive fallback: skip gracefully in CI / pipes
        if (!process.stdin.isTTY) {
          return {
            answer: '',
            skipped: true,
            reason: 'Non-interactive environment (CI / piped stdin). Proceed with the safest assumption.',
          }
        }

        // Render clean question prompt to stderr (keeps stdout clean for pipes)
        process.stderr.write(`\n❓ ${question}\n> `)

        const rl = createInterface({
          input: process.stdin,
          output: process.stderr,
        })

        try {
          const answer = (await rl.question('')).trim()
          return {
            answer,
            skipped: false,
          }
        } finally {
          rl.close()
        }
      })
    },
  })
}
