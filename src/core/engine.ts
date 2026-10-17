import { realpathSync } from 'node:fs'
import { runAgent } from './agent.ts'
import { StderrLogger, formatToolTarget, formatToolOutcome } from '../output/log.ts'
import { detectColorLevel } from '../output/color.ts'
import { setNoticeTheme } from '../output/notice.ts'
import type { Config, ExitCode, RunEvent } from './types.ts'
import { ThreadRun } from '../store/threadRun.ts'
import { TaskManagerRegistry } from '../tools/tasks.ts'
import { createOutputSink, StreamJsonSink } from '../output/sink.ts'
import { createLifecycle } from './lifecycle.ts'

export class Engine {
  async run(config: Config): Promise<ExitCode> {
    const isStderrTTY = Boolean(process.stderr.isTTY)
    const stderrColorLevel = detectColorLevel(process.env, isStderrTTY)
    const logger = new StderrLogger(config.logLevel, stderrColorLevel, config.theme, config.cwd)
    if (config.theme) setNoticeTheme(config.theme)
    const lifecycle = createLifecycle()
    const startTime = Date.now()
    const tasks = new TaskManagerRegistry()
    const mcpManager = new (await import('../mcp/manager.ts')).McpClientManager({
      cwd: config.cwd,
      bare: config.bare,
    })

    let activeSink: ReturnType<typeof createOutputSink> | undefined
    const logStderr = (fn: () => void) => {
      activeSink?.ensureLineStart?.()
      fn()
    }

    // Clamp timeout to 32-bit positive integer
    const clampedTimeoutMs = config.timeoutMs > 0 ? Math.min(config.timeoutMs, 2_147_483_647) : 0
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    if (clampedTimeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        logStderr(() => logger.error(`Execution timed out after ${clampedTimeoutMs}ms`))
        lifecycle.requestAbort('timeout', 4)
      }, clampedTimeoutMs)
      timeoutTimer.unref()
    }

    let threadRun: ThreadRun | undefined

    // Register emergency cleanups for immediate termination signals
    lifecycle.onEmergencyCleanup(() => {
      tasks.killAll()
      mcpManager.killAll()
      threadRun?.close()
    })

    try {
      let realCwd = config.cwd
      try {
        realCwd = realpathSync(config.cwd)
      } catch {
        // fallback
      }

      threadRun = ThreadRun.open({
        config,
        realCwd,
        onLog: (msg) => logger.info(msg),
      })

      const thread = threadRun.thread
      const activeToolsList = [...config.effectivePermissions.exposedTools]
      const permissionMode = config.effectivePermissions.mode

      logger.header({
        model: config.model,
        provider: config.model.split('/')[0],
        threadId: thread.id,
        title: thread.title,
        isNew: threadRun.isNewThread,
        messageCount: threadRun.initialMessages.length,
        allowedCaps: [permissionMode],
        modelMismatchOld: threadRun.modelMismatchOld,
        toolsList: activeToolsList,
      })

      // Create OutputSink according to outputFormat
      const isStdoutTTY = Boolean(process.stdout.isTTY)
      const sink = createOutputSink({
        format: config.outputFormat,
        isStdoutTTY,
        threadId: thread.id,
        checkpoints: threadRun.createdCheckpoints,
        model: config.model,
        effort: config.effort,
        startTime,
      })
      activeSink = sink

      if (sink instanceof StreamJsonSink) {
        sink.emitInit({
          threadId: thread.id,
          model: config.model,
          provider: config.model.split('/')[0],
          cwd: config.cwd,
          effort: config.effort ?? null,
          permissionMode,
          tools: activeToolsList,
          resumed: !threadRun.isNewThread,
          modelChangedFrom: threadRun.modelMismatchOld ?? null,
        })
      }

      const outcome = await runAgent({
        config,
        messages: threadRun.initialMessages,
        signal: lifecycle.signal,
        threadId: thread.id,
        agentContext: {
          tasks,
          mcpManager,
          onStepPersist: (stepMessages, usage, stepsIncrement = 1) => {
            threadRun?.recordStep(stepMessages, usage, stepsIncrement)
          },
        },
        onCheckpoint: (tool, toolCallId, files) => {
          return threadRun?.recordCheckpoint(tool, toolCallId, files) ?? 0
        },
        onEvent: (event: RunEvent) => {
          sink.onEvent(event)

          switch (event.type) {
            case 'tool-call': {
              logStderr(() => {
                const target = formatToolTarget(event.toolName, event.input, config.cwd)
                logger.toolStart(event.toolName, target, event.callId)
              })
              break
            }
            case 'tool-result': {
              logStderr(() => {
                const { summary, severity } = formatToolOutcome(
                  event.toolName,
                  event.output,
                  event.isError,
                )
                logger.toolEnd(
                  summary,
                  event.durationMs,
                  Boolean(event.isError),
                  event.callId,
                  severity,
                )
              })
              break
            }
            case 'step-finish': {
              logStderr(() => {
                logger.debug(`step ${event.stepNumber} finished (${event.finishReason})`)
              })
              break
            }
          }
        },
      })

      threadRun.finalizeOutcome(outcome)

      const checkpoints = threadRun.createdCheckpoints

      // Finalize sink
      sink.finish(outcome, {
        threadId: thread.id,
        checkpoints,
        model: config.model,
        effort: config.effort,
        startTime,
      })

      logStderr(() => {
        logger.footer({
          status: outcome.status,
          steps: outcome.stepsExecuted,
          totalTokens: outcome.usage?.totalTokens,
          durationMs: Date.now() - startTime,
          threadId: thread.id,
          hasCheckpoints: checkpoints.length > 0,
          error: outcome.error,
        })
      })

      return outcome.exitCode
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logStderr(() => logger.error(message))
      return 2
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }
      try {
        await tasks.shutdown(2000)
      } catch {
        tasks.killAll()
      }
      try {
        await mcpManager.closeAll()
      } catch {
        mcpManager.killAll()
      }
      threadRun?.close()
      lifecycle.dispose()
    }
  }
}
