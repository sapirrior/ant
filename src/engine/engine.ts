import type { ModelMessage } from 'ai'
import { AiSdkModelAdapter } from '../model/adapter.ts'
import { renderOutcome } from '../output/render.ts'
import { StderrLogger } from '../output/stderr.ts'
import { writeStdout } from '../output/stdout.ts'
import type { Config } from '../types/config.ts'
import type { ExitCode, ModelPort } from '../types/run.ts'
import { setupSignalHandler } from './signals.ts'
import { generateThreadId, getLatestThreadId, loadThread, saveThread } from './threads.ts'

export class Engine {
  constructor(private readonly modelPort: ModelPort = new AiSdkModelAdapter()) {}

  async run(config: Config): Promise<ExitCode> {
    const logger = new StderrLogger(config.logLevel)
    const { controller, cleanup } = setupSignalHandler()

    // Wall-clock timeout handler
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    if (config.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        logger.error(`Execution timed out after ${config.timeoutMs}ms`)
        controller.abort()
      }, config.timeoutMs)
    }

    try {
      // 1. Resolve conversation thread & history
      let threadId: string
      let messages: ModelMessage[] = []

      if (config.resumeThreadId) {
        threadId = config.resumeThreadId
        messages = await loadThread(threadId)
        logger.debug(`Resumed thread ${threadId} with ${messages.length} messages`)
      } else if (config.continueLatest) {
        const latestId = await getLatestThreadId()
        if (!latestId) {
          throw new Error('No previous thread found to continue. Start a new run first.')
        }
        threadId = latestId
        messages = await loadThread(threadId)
        logger.debug(`Continued latest thread ${threadId} with ${messages.length} messages`)
      } else {
        threadId = generateThreadId()
      }

      // 2. Assemble user input from prompt and stdin
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

      logger.info(`Starting execution (model: ${config.model}, thread: ${threadId})`)

      // 3. Execute model loop
      const outcome = await this.modelPort.run({
        config,
        messages,
        signal: controller.signal,
        onEvent: (event) => {
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
              logger.toolCall(event.toolName, summary)
              break
            }
            case 'tool-result':
              logger.toolResult(event.toolName, event.durationMs)
              break
            case 'step-finish':
              logger.debug(`step ${event.stepNumber} finished (${event.finishReason})`)
              break
          }
        },
      })

      // 4. Update and persist thread history
      if (outcome.text) {
        messages.push({
          role: 'assistant',
          content: outcome.text,
        })
      }
      await saveThread(threadId, messages)

      // 5. Output rendering & logging
      if (outcome.status === 'completed') {
        logger.completed(outcome.stepsExecuted, outcome.usage?.totalTokens)
      } else if (outcome.error) {
        logger.error(outcome.error)
      } else {
        logger.error(`Execution finished with status: ${outcome.status}`)
      }

      const renderedOutput = renderOutcome(outcome, config.outputFormat)
      writeStdout(renderedOutput)

      return outcome.exitCode
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(message)
      return 2 // usage or configuration error
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }
      cleanup()
    }
  }
}
