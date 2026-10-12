import type { ModelMessage } from 'ai'
import { runAgent } from './agent.ts'
import { renderOutcome, writeStdout } from '../output/render.ts'
import { StderrLogger } from '../output/log.ts'
import type { Config, ExitCode, RunEvent } from './types.ts'
import { generateThreadId, getLatestThreadId, loadThread, saveThread } from '../store/threads.ts'

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

    try {
      let threadId: string
      let messages: ModelMessage[] = []
      let isNewThread = true

      if (config.resumeThreadId) {
        threadId = config.resumeThreadId
        messages = await loadThread(threadId)
        isNewThread = false
        logger.debug(`Resumed thread ${threadId} with ${messages.length} messages`)
      } else if (config.continueLatest) {
        const latestId = await getLatestThreadId()
        if (!latestId) {
          throw new Error('No previous thread found to continue. Start a new run first.')
        }
        threadId = latestId
        messages = await loadThread(threadId)
        isNewThread = false
        logger.debug(`Continued latest thread ${threadId} with ${messages.length} messages`)
      } else {
        threadId = generateThreadId()
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

      messages.push({
        role: 'user',
        content: userContent,
      })

      const allowedCaps: string[] = []
      if (config.grants.has('fs.read')) allowedCaps.push('read')
      if (config.grants.has('fs.write')) allowedCaps.push('edit')
      if (config.grants.has('shell.run')) allowedCaps.push('bash')
      if (config.grants.has('shell.destructive')) allowedCaps.push('destructiveBash')

      logger.header({
        model: config.model,
        threadId,
        title: userContent.replace(/\s+/g, ' ').slice(0, 80),
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
        messages.push({
          role: 'assistant',
          content: outcome.text,
        })
      }
      await saveThread(threadId, messages)

      logger.footer({
        status: outcome.status,
        steps: outcome.stepsExecuted,
        totalTokens: outcome.usage?.totalTokens,
        durationMs: Date.now() - startTime,
        threadId,
        error: outcome.error,
      })

      const renderedOutput = renderOutcome(outcome, {
        format: config.outputFormat,
        threadId,
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
      cleanup()
    }
  }
}
