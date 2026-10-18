import { existsSync } from 'node:fs'
import { constants } from 'node:os'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { BASH_DESCRIPTION } from './prompt.ts'

export const bashInputSchema = z.object({
  command: z.string().describe('The command line string to execute in bash/sh.'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(600000)
    .optional()
    .describe('Hard timeout in ms before SIGTERM/SIGKILL (1000..600000).'),
  background: z
    .boolean()
    .optional()
    .describe('Start in background immediately (skips foreground wait).'),
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
      return executeWithPolicy('Bash', input, context, async (args) => {
        const foregroundMs = context.foregroundMs ?? 10000
        const backgroundEnabled = context.backgroundEnabled ?? context.tasks !== undefined
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
          stdio: [args.background ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          env,
        })

        const spawnPromise = new Promise<void>((resolve, reject) => {
          child.once('spawn', () => resolve())
          child.once('error', (err) => reject(err))
        })

        try {
          await spawnPromise
        } catch (err) {
          throw new Error(
            `Failed to spawn bash process: ${err instanceof Error ? err.message : String(err)}`,
          )
        }

        const pid = child.pid!
        let combinedOutput = ''
        let totalChars = 0
        let exitCode: number | null = null
        let exitSignal: string | null = null

        const stdoutDecoder = new StringDecoder('utf-8')
        const stderrDecoder = new StringDecoder('utf-8')

        // Cap buffer during collection to prevent unbounded memory growth (B-004)
        const MAX_BUFFER = 100000
        const appendStdout = (chunk: Buffer | string) => {
          const str = typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk)
          totalChars += str.length
          combinedOutput += str
          if (combinedOutput.length > MAX_BUFFER) {
            combinedOutput = combinedOutput.slice(-MAX_BUFFER)
          }
        }

        const appendStderr = (chunk: Buffer | string) => {
          const str = typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk)
          totalChars += str.length
          combinedOutput += str
          if (combinedOutput.length > MAX_BUFFER) {
            combinedOutput = combinedOutput.slice(-MAX_BUFFER)
          }
        }

        child.stdout?.on('data', appendStdout)
        child.stderr?.on('data', appendStderr)

        const closePromise = new Promise<{ code: number | null; signal: string | null }>(
          (resolve) => {
            child.on('close', (code, sig) => {
              exitCode = code
              exitSignal = sig
              resolve({ code, signal: sig })
            })
            child.on('error', () => {
              resolve({ code: 1, signal: null })
            })
          },
        )

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

        let foregroundTimeoutHandle: NodeJS.Timeout | null = null

        try {
          // If immediate background requested and enabled:
          if (args.background && backgroundEnabled && context.tasks) {
            child.stdout?.removeListener('data', appendStdout)
            child.stderr?.removeListener('data', appendStderr)
            const task = context.tasks.createTask(args.command, child, combinedOutput)
            if (hardTimer) {
              task.hardTimer = hardTimer
              hardTimer = null
            }
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
            new Promise<{ type: 'foreground_timeout' }>((resolve) => {
              foregroundTimeoutHandle = setTimeout(
                () => resolve({ type: 'foreground_timeout' }),
                foregroundMs,
              )
            }),
          ])

          if (waitResult.type === 'exit') {
            const finalOutput = formatOutputChars(combinedOutput, totalChars)
            let exitCode = waitResult.res.code
            if (exitCode === null) {
              const sig = waitResult.res.signal
              const sigNum = sig
                ? (constants.signals as Record<string, number> | undefined)?.[sig]
                : undefined
              exitCode = typeof sigNum === 'number' ? 128 + sigNum : 1
            }
            return {
              status: 'exited',
              exitCode,
              signal: waitResult.res.signal,
              output: finalOutput.text,
              truncated: finalOutput.truncated,
            }
          }

          // Still running after foregroundMs
          if (backgroundEnabled && context.tasks) {
            child.stdout?.removeListener('data', appendStdout)
            child.stderr?.removeListener('data', appendStderr)
            const task = context.tasks.createTask(args.command, child, combinedOutput)
            if (hardTimer) {
              task.hardTimer = hardTimer
              hardTimer = null
            }
            return {
              status: 'running',
              taskId: task.id,
              output: combinedOutput.slice(-4000),
              note: `Still running after ${(foregroundMs / 1000).toFixed(0)}s; moved to background as ${task.id}. Use TaskManager to read output, send input, or stop it.`,
            }
          }

          // Not background-enabled: kill and report timed_out
          killGroup('SIGTERM')
          const killTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              killGroup('SIGKILL')
            }
          }, 3000)
          killTimer.unref()
          await closePromise
          clearTimeout(killTimer)
          const finalOutput = formatOutputChars(combinedOutput, totalChars)
          return {
            status: 'timed_out',
            exitCode: exitCode ?? 1,
            signal: exitSignal,
            output: finalOutput.text,
            truncated: finalOutput.truncated,
            error: `Command timed out after ${(foregroundMs / 1000).toFixed(0)}s.`,
          }
        } finally {
          if (foregroundTimeoutHandle) clearTimeout(foregroundTimeoutHandle)
          if (hardTimer) clearTimeout(hardTimer)
          context.abortSignal?.removeEventListener('abort', abortHandler)
        }
      })
    },
  })
}

function formatOutputChars(raw: string, totalChars: number): { text: string; truncated: boolean } {
  const MAX_CHARS = 30000
  if (totalChars <= MAX_CHARS) {
    return { text: raw, truncated: false }
  }
  const head = raw.slice(0, 10000)
  const tail = raw.slice(-20000)
  const omitted = totalChars - 30000
  return {
    text: `${head}\n[... ${omitted} chars omitted ...]\n${tail}`,
    truncated: true,
  }
}
