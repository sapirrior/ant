import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionContext } from '../../core/types.ts'
import { classifyBashCommand } from '../../policy/bash.ts'
import { promptConfirmTTY } from '../../output/tty.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { BASH_DESCRIPTION } from './prompt.ts'

export const bashInputSchema = z.object({
  command: z.string().describe('The command line string to execute in bash/sh.'),
  timeoutMs: z.number().int().min(1000).max(600000).optional().describe('Hard timeout in ms before SIGTERM/SIGKILL (1000..600000).'),
  background: z.boolean().optional().describe('Start in background immediately (skips foreground wait).'),
})

export function describeBash(input: z.infer<typeof bashInputSchema>): string {
  const cmd = input.command.replace(/\s+/g, ' ').trim()
  return cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd
}

export function summarizeBash(output: unknown): string {
  if (!output || typeof output !== 'object') {
    return 'done'
  }
  const obj = output as Record<string, unknown>
  if (obj.status === 'running') {
    return `↗ running in background as ${obj.taskId ?? ''}`
  }
  if (obj.status === 'timed_out') {
    return 'timed out'
  }
  if (obj.status === 'exited') {
    return `exit ${obj.exitCode ?? 0}`
  }
  return 'done'
}

function buildCleanEnv(customPassEnv: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const secretPattern = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i
  const passSet = new Set(customPassEnv)

  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue
    if (key.startsWith('ANT_')) continue
    if (secretPattern.test(key) && !passSet.has(key)) continue
    env[key] = val
  }

  // Fixed standard execution variables
  env.TERM = 'dumb'
  env.NO_COLOR = '1'
  env.CI = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_PAGER = 'cat'
  env.PAGER = 'cat'
  env.GIT_EDITOR = 'true'

  return env
}

export function createBashTool(context: ToolExecutionContext) {
  return tool({
    description: BASH_DESCRIPTION,
    inputSchema: bashInputSchema,
    execute: async (input) => {
      // 1. Classification & policy check BEFORE entering execution queue/timer
      const verdict = classifyBashCommand(input.command, context.cwd)

      if (verdict.status === 'blocked') {
        return {
          ok: false,
          output: null,
          error: `Command blocked by safety policy: ${verdict.reason}`,
        }
      }

      if (verdict.status === 'ask' && !context.grants.has('shell.destructive')) {
        // Must confirm interactively via /dev/tty
        const confirmed = context.ui?.confirm
          ? context.ui.confirm({
              message: 'Bash wants to run',
              command: input.command,
              reason: verdict.reason,
            })
          : promptConfirmTTY({
              message: 'Bash wants to run',
              command: input.command,
              reason: verdict.reason,
            })

        if (!confirmed) {
          return {
            ok: false,
            output: null,
            error:
              'User denied permission to run this command. Do not retry the same command; ask the user or choose another approach.',
          }
        }
      }

      return executeWithPolicy('Bash', input, context, async (args) => {
        const foregroundMs = context.foregroundMs ?? 10000
        const backgroundEnabled = context.backgroundEnabled ?? (context.tasks !== undefined)
        const env = buildCleanEnv(context.passEnv)

        // Shell binary selection: check bash or fallback to sh
        let shellBin = '/bin/bash'
        if (!existsSync(shellBin)) {
          if (process.env.SHELL && existsSync(process.env.SHELL)) {
            shellBin = process.env.SHELL
          } else if (existsSync('/data/data/com.termux/files/usr/bin/bash')) {
            shellBin = '/data/data/com.termux/files/usr/bin/bash'
          } else if (existsSync('/bin/sh')) {
            shellBin = '/bin/sh'
          } else {
            shellBin = 'sh'
          }
        }

        const child = spawn(shellBin, ['-c', args.command], {
          cwd: context.cwd,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        })

        if (!child.pid) {
          throw new Error('Failed to spawn bash process.')
        }

        const pid = child.pid
        let combinedOutput = ''
        let exitCode: number | null = null
        let exitSignal: string | null = null

        const appendChunk = (chunk: Buffer | string) => {
          combinedOutput += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
        }

        child.stdout?.on('data', appendChunk)
        child.stderr?.on('data', appendChunk)

        const closePromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
          child.on('close', (code, sig) => {
            exitCode = code
            exitSignal = sig
            resolve({ code, signal: sig })
          })
          child.on('error', () => {
            resolve({ code: 1, signal: null })
          })
        })

        // Process group kill helper
        const killGroup = (sig: NodeJS.Signals = 'SIGTERM') => {
          try {
            process.kill(-pid, sig)
          } catch {
            try {
              child.kill(sig)
            } catch {
              // ignore
            }
          }
        }

        // Setup abort signal handler
        const abortHandler = () => {
          killGroup('SIGTERM')
        }
        context.abortSignal?.addEventListener('abort', abortHandler, { once: true })

        // Hard timeoutMs handler if specified
        let hardTimer: NodeJS.Timeout | null = null
        if (args.timeoutMs) {
          hardTimer = setTimeout(() => {
            killGroup('SIGTERM')
            setTimeout(() => {
              killGroup('SIGKILL')
            }, 3000).unref()
          }, args.timeoutMs)
          hardTimer.unref()
        }

        try {
          // If immediate background requested and enabled:
          if (args.background && backgroundEnabled && context.tasks) {
            // TaskManager hand-off immediately
            const task = context.tasks.createTask(args.command, child)
            return {
              status: 'running',
              taskId: task.id,
              output: combinedOutput.slice(-4000),
              note: `Started in background as ${task.id}. Use TaskManager to read output, send input, or stop it.`,
            }
          }

          // Otherwise, wait up to foregroundMs
          const waitResult = await Promise.race([
            closePromise.then((res) => ({ type: 'exit' as const, res })),
            new Promise<{ type: 'foreground_timeout' }>((resolve) =>
              setTimeout(() => resolve({ type: 'foreground_timeout' }), foregroundMs)
            ),
          ])

          if (waitResult.type === 'exit') {
            const finalOutput = formatOutputChars(combinedOutput)
            return {
              status: 'exited',
              exitCode: waitResult.res.code ?? 0,
              signal: waitResult.res.signal,
              output: finalOutput.text,
              truncated: finalOutput.truncated,
            }
          }

          // Still running after foregroundMs
          if (backgroundEnabled && context.tasks) {
            const task = context.tasks.createTask(args.command, child)
            return {
              status: 'running',
              taskId: task.id,
              output: combinedOutput.slice(-4000),
              note: `Still running after ${(foregroundMs / 1000).toFixed(0)}s; moved to background as ${task.id}. Use TaskManager to read output, send input, or stop it.`,
            }
          }

          // Not background-enabled: kill and report timed_out
          killGroup('SIGTERM')
          setTimeout(() => killGroup('SIGKILL'), 3000).unref()
          await closePromise
          const finalOutput = formatOutputChars(combinedOutput)
          return {
            status: 'timed_out',
            exitCode: exitCode ?? 1,
            signal: exitSignal,
            output: finalOutput.text,
            truncated: finalOutput.truncated,
            error: `Command timed out after ${(foregroundMs / 1000).toFixed(0)}s.`,
          }
        } finally {
          if (hardTimer) clearTimeout(hardTimer)
          context.abortSignal?.removeEventListener('abort', abortHandler)
        }
      })
    },
  })
}

function formatOutputChars(raw: string): { text: string; truncated: boolean } {
  const MAX_CHARS = 30000
  if (raw.length <= MAX_CHARS) {
    return { text: raw, truncated: false }
  }
  const head = raw.slice(0, 10000)
  const tail = raw.slice(-20000)
  const omitted = raw.length - 30000
  return {
    text: `${head}\n[... ${omitted} chars omitted ...]\n${tail}`,
    truncated: true,
  }
}
