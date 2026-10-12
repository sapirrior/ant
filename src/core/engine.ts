import type { ModelMessage } from 'ai'
import { realpathSync } from 'node:fs'
import { runAgent } from './agent.ts'
import { renderOutcome, writeStdout } from '../output/render.ts'
import { StderrLogger } from '../output/log.ts'
import type { Config, ExitCode, RunEvent } from './types.ts'
import { openDb, acquireLease, releaseLease } from '../store/db.ts'
import {
  createThread,
  getThread,
  getMessages,
  appendMessage,
  type ThreadRecord,
} from '../store/threads.ts'

export function setupSignalHandler(): {
  readonly controller: AbortController
  readonly cleanup: () => void
} {
  const controller = new AbortController()

  const handleSignal = () => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  }

  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)

  const cleanup = () => {
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
  }

  return { controller, cleanup }
}

export class Engine {
  async run(config: Config): Promise<ExitCode> {
    const logger = new StderrLogger(config.logLevel)
    const { controller, cleanup } = setupSignalHandler()
    const startTime = Date.now()

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    if (config.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        logger.error(`Execution timed out after ${config.timeoutMs}ms`)
        controller.abort()
      }, config.timeoutMs)
    }

    const db = openDb()
    let activeThreadId: string | undefined

    try {
      let thread: ThreadRecord
      let messages: ModelMessage[] = []
      let isNewThread = true

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
          logger.debug(`Thread model was ${thread.model}, running with ${config.model}`)
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
        logger.debug(`Resumed thread ${thread.id} with ${messages.length} messages`)
      } else if (config.continueLatest) {
        thread = getThread(db, 'latest', realCwd)
        if (thread.cwd !== realCwd) {
          throw new Error(`thread belongs to ${thread.cwd}; cd there first`)
        }
        if (thread.model !== config.model) {
          logger.debug(`Thread model was ${thread.model}, running with ${config.model}`)
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
        logger.debug(`Continued latest thread ${thread.id} with ${messages.length} messages`)
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
      })

      const outcome = await runAgent({
        config,
        messages,
        signal: controller.signal,
        onEvent: (event: RunEvent) => {
          switch (event.type) {
            case 'tool-call': {
              let summary: string | undefined
              if (typeof event.input === 'object' && event.input !== null) {
                const obj = event.input as Record<string, unknown>
                if (typeof obj.path === 'string') summary = obj.path
                else if (typeof obj.command === 'string') summary = `"${obj.command.slice(0, 50)}"`
                else if (typeof obj.pattern === 'string') summary = `/${obj.pattern}/`
                else if (typeof obj.question === 'string') summary = `"${obj.question.slice(0, 50)}"`
              }
              logger.toolStart(event.toolName, summary)
              break
            }
            case 'tool-result':
              logger.toolEnd('done', event.durationMs, Boolean(event.isError))
              break
            case 'step-finish':
              logger.debug(`step ${event.stepNumber} finished (${event.finishReason})`)
              break
          }
        },
      })

      if (outcome.text) {
        const assistantMsg: ModelMessage = {
          role: 'assistant',
          content: outcome.text,
        }
        appendMessage(db, thread.id, assistantMsg)
        messages.push(assistantMsg)
      } else if (outcome.status !== 'completed') {
        const stored = getMessages(db, thread.id)
        if (stored.length > 0 && stored[stored.length - 1]!.role === 'user') {
          const syntheticMsg: ModelMessage = {
            role: 'assistant',
            content: `[ant: run ended with ${outcome.status}: ${outcome.error ?? 'not completed'}]`,
          }
          appendMessage(db, thread.id, syntheticMsg)
        }
      }

      logger.footer({
        status: outcome.status,
        steps: outcome.stepsExecuted,
        totalTokens: outcome.usage?.totalTokens,
        durationMs: Date.now() - startTime,
        threadId: thread.id,
        error: outcome.error,
      })

      const renderedOutput = renderOutcome(outcome, {
        format: config.outputFormat,
        threadId: thread.id,
      })
      writeStdout(renderedOutput)

      return outcome.exitCode
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(message)
      return 2
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }
      if (activeThreadId) {
        try {
          releaseLease(db, activeThreadId)
        } catch {
          // ignore release errors on cleanup
        }
      }
      db.close()
      cleanup()
    }
  }
}
