import { exec } from 'node:child_process'
import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionContext } from '../../types/tools.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { classifyCommand } from './classify.ts'
import { BASH_DESCRIPTION } from './prompt.ts'

export const bashInputSchema = z.object({
  command: z.string().describe('The command line string to execute in bash/sh.'),
  timeoutMs: z.number().int().min(1000).default(30000).describe('Max execution time in ms (default 30000).'),
})

export function createBashTool(context: ToolExecutionContext) {
  return tool({
    description: BASH_DESCRIPTION,
    inputSchema: bashInputSchema,
    execute: async (input) => {
      return executeWithPolicy('Bash', input, context, async ({ command, timeoutMs }) => {
        // Additional security check for destructive commands
        const category = classifyCommand(command)
        if (category === 'destructive' && !context.grants.has('shell.destructive')) {
          throw new Error(
            `Command "${command}" is classified as potentially destructive and requires --allow-destructive-bash capability.`
          )
        }

        return new Promise((resolve) => {
          exec(
            command,
            {
              cwd: context.cwd,
              timeout: timeoutMs,
              maxBuffer: 5 * 1024 * 1024, // 5 MiB
              shell: process.env.SHELL || '/bin/sh',
            },
            (error, stdout, stderr) => {
              if (error) {
                resolve({
                  command,
                  exitCode: error.code ?? 1,
                  stdout: stdout.trim(),
                  stderr: (stderr || error.message).trim(),
                  timedOut: error.killed && error.signal === 'SIGTERM',
                })
              } else {
                resolve({
                  command,
                  exitCode: 0,
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  timedOut: false,
                })
              }
            }
          )
        })
      })
    },
  })
}
