import type { ModelMessage } from 'ai'
import { realpathSync } from 'node:fs'
import { runAgent } from './agent.ts'
import { renderOutcome, writeStdout } from '../output/render.ts'
import { StderrLogger } from '../output/log.ts'
import type { Config, ExitCode, RunEvent, UsageSummary } from './types.ts'
import { openDb, acquireLease, releaseLease } from '../store/db.ts'
import {
  createThread,
  getThread,
  getMessages,
  appendMessage,
  type ThreadRecord,
} from '../store/threads.ts'
import { recordCheckpoint } from '../store/checkpoints.ts'
import { TaskManagerRegistry } from '../tools/tasks.ts'
import { StreamingMarkdownRenderer } from '../output/markdown.ts'

export function setupSignalHandler(): {
  readonly controller: AbortController
  readonly cleanup: () => void
} {
  const controller = new AbortController()

  const handleSigint = () => {
    if (!controller.signal.aborted) {
      ;(controller.signal as any).reason = 'SIGINT'
      controller.abort()
    } else {
      // Second SIGINT forces hard exit 130
      process.exit(130)
    }
  }

  const handleSigterm = () => {
    if (!controller.signal.aborted) {
      ;(controller.signal as any).reason = 'SIGTERM'
      controller.abort()
    }
  }

  process.on('SIGINT', handleSigint)
  process.on('SIGTERM', handleSigterm)

  const cleanup = () => {
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
  }

  return { controller, cleanup }
}

export class Engine {
  async run(config: Config): Promise<ExitCode> {
    const logger = new StderrLogger(config.logLevel)
    const { controller, cleanup } = setupSignalHandler()
    const startTime = Date.now()
    const tasks = new TaskManagerRegistry()
    const createdCheckpoints: number[] = []

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    if (config.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        logger.error(`Execution timed out after ${config.timeoutMs}ms`)
        ;(controller.signal as any).reason = 'timeout'
        controller.abort()
      }, config.timeoutMs)
      timeoutTimer.unref()
    }

    const db = openDb()
    let activeThreadId: string | undefined

    try {
      let thread: ThreadRecord
      let messages: ModelMessage[] = []
      let isNewThread = true
      let modelMismatchOld: string | undefined

      let realCwd = config.cwd
      try {
        realCwd = realpathSync(config.cwd)
      } catch {
        // fallback
      }

      if (config.resumeThreadId) {
        thread = getThread(db, config.resumeThreadId, realCwd)
        if (thread.cwd !== realCwd) {
          throw new Error(`thread belongs to ${thread.cwd}; cd there first`)
        }
        if (thread.model !== config.model) {
          modelMismatchOld = thread.model
          db.run('UPDATE threads SET model = ?, updated_at = ? WHERE id = ?', [
            config.model,
            Date.now(),
            thread.id,
          ])
          thread.model = config.model
        }
        activeThreadId = thread.id
        acquireLease(db, thread.id)
        messages = getMessages(db, thread.id)
        isNewThread = false
      } else if (config.continueLatest) {
        thread = getThread(db, 'latest', realCwd)
        if (thread.cwd !== realCwd) {
          throw new Error(`thread belongs to ${thread.cwd}; cd there first`)
        }
        if (thread.model !== config.model) {
          modelMismatchOld = thread.model
          db.run('UPDATE threads SET model = ?, updated_at = ? WHERE id = ?', [
            config.model,
            Date.now(),
            thread.id,
          ])
          thread.model = config.model
        }
        activeThreadId = thread.id
        acquireLease(db, thread.id)
        messages = getMessages(db, thread.id)
        isNewThread = false
      } else {
        thread = createThread(db, {
          prompt: config.prompt,
          stdinInput: config.stdinInput,
          cwd: realCwd,
          model: config.model,
        })
        activeThreadId = thread.id
        acquireLease(db, thread.id)
      }

      let userContent = ''
      if (config.prompt && config.stdinInput) {
        userContent = `${config.prompt}\n\n[Piped Input]:\n${config.stdinInput}`
      } else if (config.prompt) {
        userContent = config.prompt
      } else if (config.stdinInput) {
        userContent = config.stdinInput
      } else {
        throw new Error('No instruction provided. Pass a prompt via -p "..." or pipe input via stdin.')
      }

      const userMessage: ModelMessage = {
        role: 'user',
        content: userContent,
      }
      appendMessage(db, thread.id, userMessage)
      messages.push(userMessage)

      const allowedCaps: string[] = []
      if (config.grants.has('fs.read')) allowedCaps.push('read')
      if (config.grants.has('fs.write')) allowedCaps.push('edit')
      if (config.grants.has('shell.run')) allowedCaps.push('bash')
      if (config.grants.has('shell.destructive')) allowedCaps.push('destructiveBash')

      logger.header({
        model: config.model,
        threadId: thread.id,
        title: thread.title,
        isNew: isNewThread,
        messageCount: messages.length,
        allowedCaps,
        modelMismatchOld,
      })

      // Track live streaming vs buffered output
      const isStdoutTTY = Boolean(process.stdout.isTTY)
      const isJsonOutput = config.outputFormat === 'json'
      const streamRenderer = new StreamingMarkdownRenderer()
      let atLineStart = true

      const outcome = await runAgent({
        config,
        messages,
        signal: controller.signal,
        threadId: thread.id,
        agentContext: {
          tasks,
          onStepPersist: (stepMessages: ModelMessage[], usage?: UsageSummary) => {
            for (const msg of stepMessages) {
              appendMessage(db, thread.id, msg)
            }
            if (usage?.inputTokens || usage?.outputTokens) {
              db.run(
                `UPDATE threads SET 
                   input_tokens = input_tokens + ?, 
                   output_tokens = output_tokens + ?,
                   updated_at = ?
                 WHERE id = ?`,
                [usage.inputTokens ?? 0, usage.outputTokens ?? 0, Date.now(), thread.id]
              )
            }
          },
        },
        onCheckpoint: (tool, toolCallId, files) => {
          const seq = recordCheckpoint(db, thread.id, tool, toolCallId, files)
          createdCheckpoints.push(seq)
          return seq
        },
        onEvent: (event: RunEvent) => {
          switch (event.type) {
            case 'text-delta': {
              if (isStdoutTTY && !isJsonOutput) {
                if (config.outputFormat === 'md') {
                  const renderedChunk = streamRenderer.append(event.delta)
                  if (renderedChunk) {
                    process.stdout.write(renderedChunk)
                    atLineStart = renderedChunk.endsWith('\n')
                  }
                } else {
                  process.stdout.write(event.delta)
                  atLineStart = event.delta.endsWith('\n')
                }
              }
              break
            }
            case 'tool-call': {
              if (isStdoutTTY && !atLineStart) {
                process.stdout.write('\n')
                atLineStart = true
              }
              let summary: string | undefined
              if (typeof event.input === 'object' && event.input !== null) {
                const obj = event.input as Record<string, unknown>
                if (typeof obj.path === 'string') summary = obj.path
                else if (typeof obj.command === 'string') summary = `"${obj.command.slice(0, 50)}"`
                else if (typeof obj.query === 'string') summary = `"${obj.query.slice(0, 50)}"`
                else if (typeof obj.url === 'string') summary = obj.url.slice(0, 50)
                else if (typeof obj.pattern === 'string') summary = `/${obj.pattern}/`
                else if (typeof obj.action === 'string') summary = `${obj.action} ${obj.taskId ?? ''}`.trim()
                else if (typeof obj.question === 'string') summary = `"${obj.question.slice(0, 50)}"`
              }
              logger.toolStart(event.toolName, summary)
              break
            }
            case 'tool-result': {
              if (isStdoutTTY && !atLineStart) {
                process.stdout.write('\n')
                atLineStart = true
              }
              logger.toolEnd('done', event.durationMs, Boolean(event.isError))
              break
            }
            case 'step-finish': {
              logger.debug(`step ${event.stepNumber} finished (${event.finishReason})`)
              break
            }
          }
        },
      })

      // If run ended without an assistant message, append synthetic one for provider alternation
      if (outcome.status !== 'completed' && !outcome.text) {
        const stored = getMessages(db, thread.id)
        if (stored.length > 0 && stored[stored.length - 1]!.role === 'user') {
          const syntheticMsg: ModelMessage = {
            role: 'assistant',
            content: `[ant: run ended with ${outcome.status}: ${outcome.error ?? 'incomplete'}]`,
          }
          appendMessage(db, thread.id, syntheticMsg)
        }
      }

      // Non-TTY stdout gets the final text printed once; TTY flushes remaining stream buffer
      if (!isStdoutTTY || isJsonOutput) {
        const renderedOutput = renderOutcome(outcome, {
          format: config.outputFormat,
          threadId: thread.id,
          checkpoints: createdCheckpoints,
        })
        writeStdout(renderedOutput)
      } else {
        if (config.outputFormat === 'md') {
          const flushed = streamRenderer.flush()
          if (flushed) {
            process.stdout.write(flushed)
            atLineStart = flushed.endsWith('\n')
          }
        }
        if (!atLineStart) {
          process.stdout.write('\n')
        }
      }

      logger.footer({
        status: outcome.status,
        steps: outcome.stepsExecuted,
        totalTokens: outcome.usage?.totalTokens,
        durationMs: Date.now() - startTime,
        threadId: thread.id,
        hasCheckpoints: createdCheckpoints.length > 0,
        error: outcome.error,
      })

      return outcome.exitCode
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(message)
      return 2
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }
      tasks.killAll()
      if (activeThreadId) {
        try {
          releaseLease(db, activeThreadId)
        } catch {
          // ignore lease release failure on final teardown
        }
      }
      db.close()
      cleanup()
    }
  }
}
