import type { ModelMessage } from 'ai'
import type { Database } from 'bun:sqlite'
import { realpathSync } from 'node:fs'
import { runAgent } from './agent.ts'
import { StderrLogger, formatToolTarget, formatToolOutcome } from '../output/log.ts'
import { detectColorLevel } from '../output/color.ts'
import { setNoticeTheme } from '../output/notice.ts'
import type { Config, ExitCode, RunEvent, UsageSummary } from './types.ts'
import { openDb, acquireLease, releaseLease } from '../store/db.ts'
import {
  createThread,
  getThread,
  getMessages,
  appendMessage,
  appendMessages,
  recordStepMessages,
  type ThreadRecord,
} from '../store/threads.ts'
import { recordCheckpoint } from '../store/checkpoints.ts'
import { TaskManagerRegistry } from '../tools/tasks.ts'
import { createOutputSink, StreamJsonSink } from '../output/sink.ts'
import { createLifecycle } from './lifecycle.ts'
import { repairHistory } from '../store/repair.ts'

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
    const createdCheckpoints: number[] = []

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

    let db: Database | undefined
    let activeThreadId: string | undefined
    const heartbeatTimer = setInterval(() => {
      if (db && activeThreadId) {
        try {
          db.run('UPDATE threads SET lock_at = ? WHERE id = ? AND lock_pid = ?', [
            Date.now(),
            activeThreadId,
            process.pid,
          ])
        } catch {}
      }
    }, 10_000)
    heartbeatTimer.unref()

    // Register emergency cleanups for immediate termination signals
    lifecycle.onEmergencyCleanup(() => {
      tasks.killAll()
      mcpManager.killAll()
      if (db && activeThreadId) {
        try {
          releaseLease(db, activeThreadId)
        } catch {}
      }
      if (db) {
        try {
          db.close()
        } catch {}
      }
    })

    try {
      const isPersistent = !config.noSessionPersistence
      if (isPersistent) {
        db = openDb()
      }

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

      const loadExisting = (threadIdOrLatest: string) => {
        if (!db) throw new Error('Cannot resume thread when persistence is disabled')
        const t = getThread(db, threadIdOrLatest, realCwd)
        if (t.cwd !== realCwd) {
          throw new Error(`thread belongs to ${t.cwd}; cd there first`)
        }
        activeThreadId = t.id
        acquireLease(db, t.id)
        if (t.model !== config.model) {
          modelMismatchOld = t.model
          db.run('UPDATE threads SET model = ?, updated_at = ? WHERE id = ?', [
            config.model,
            Date.now(),
            t.id,
          ])
          t.model = config.model
        }
        const storedMessages = getMessages(db, t.id)
        const repaired = repairHistory(storedMessages)
        if (repaired.repaired.length > 0) {
          logger.info(`Session history repaired: ${repaired.repaired.join(', ')}`)
          const tail = repaired.messages.slice(storedMessages.length)
          if (tail.length > 0) {
            appendMessages(db, t.id, tail)
          }
        }
        return { t, msgs: repaired.messages }
      }

      const buildUserContent = () => {
        if (config.prompt && config.stdinInput) {
          return `${config.prompt}\n\n[Piped Input]:\n${config.stdinInput}`
        }
        return config.prompt || config.stdinInput || undefined
      }

      const existingThreadId = config.resumeThreadId ?? (config.continueLatest ? 'latest' : undefined)
      if (existingThreadId) {
        const loaded = loadExisting(existingThreadId)
        thread = loaded.t
        messages = loaded.msgs
        isNewThread = false

        const userContent = buildUserContent()
        if (userContent) {
          const userMessage: ModelMessage = {
            role: 'user',
            content: userContent,
          }
          if (db) appendMessage(db, thread.id, userMessage)
          messages.push(userMessage)
        } else {
          // If continuing/resuming without an additional prompt, ensure conversation ends in a user turn
          const lastMsg = messages[messages.length - 1]
          if (!lastMsg || lastMsg.role !== 'user') {
            const continueMessage: ModelMessage = {
              role: 'user',
              content: 'Continue where you left off.',
            }
            if (db) appendMessage(db, thread.id, continueMessage)
            messages.push(continueMessage)
          }
        }
      } else {
        const userContent = buildUserContent()
        if (!userContent) {
          throw new Error('No instruction provided. Pass a prompt via -p "..." or pipe input via stdin.')
        }

        if (isPersistent && db) {
          thread = createThread(db, {
            prompt: config.prompt,
            stdinInput: config.stdinInput,
            cwd: realCwd,
            model: config.model,
          })
          activeThreadId = thread.id
          acquireLease(db, thread.id)
        } else {
          thread = {
            id: 'ephemeral',
            title: config.prompt ? config.prompt.slice(0, 50) : 'Ephemeral session',
            cwd: realCwd,
            model: config.model,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            turns: 0,
            messages: 0,
            steps: 0,
            inputTokens: 0,
            outputTokens: 0,
            lockPid: null,
            lockAt: null,
          }
        }

        const userMessage: ModelMessage = {
          role: 'user',
          content: userContent,
        }
        if (db) appendMessage(db, thread.id, userMessage)
        messages.push(userMessage)
      }

      const activeToolsList = [...config.effectivePermissions.exposedTools]
      const permissionMode = config.effectivePermissions.mode

      logger.header({
        model: config.model,
        provider: config.model.split('/')[0],
        threadId: thread.id,
        title: thread.title,
        isNew: isNewThread,
        messageCount: messages.length,
        allowedCaps: [permissionMode],
        modelMismatchOld,
        toolsList: activeToolsList,
      })

      // Create OutputSink according to outputFormat
      const isStdoutTTY = Boolean(process.stdout.isTTY)
      const stdoutColorLevel = detectColorLevel(process.env, isStdoutTTY)
      const sink = createOutputSink({
        format: config.outputFormat,
        isStdoutTTY,
        threadId: thread.id,
        checkpoints: createdCheckpoints,
        model: config.model,
        effort: config.effort,
        startTime,
        colorLevel: stdoutColorLevel,
        theme: config.theme,
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
          resumed: !isNewThread,
          modelChangedFrom: modelMismatchOld ?? null,
        })
      }

      const outcome = await runAgent({
        config,
        messages,
        signal: lifecycle.signal,
        threadId: thread.id,
        agentContext: {
          tasks,
          mcpManager,
          onStepPersist: (stepMessages: ModelMessage[], usage?: UsageSummary, stepsIncrement = 1) => {
            if (db) {
              recordStepMessages(db, thread.id, stepMessages, stepsIncrement, usage)
            }
          },
        },
        onCheckpoint: (tool, toolCallId, files) => {
          if (db) {
            const seq = recordCheckpoint(db, thread.id, tool, toolCallId, files)
            createdCheckpoints.push(seq)
            return seq
          }
          return 0
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
                  event.isError
                )
                logger.toolEnd(summary, event.durationMs, Boolean(event.isError), event.callId, severity)
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

      // If run ended without an assistant message, append synthetic one for provider alternation
      if (db && outcome.status !== 'completed' && !outcome.text) {
        const stored = getMessages(db, thread.id)
        if (stored.length > 0 && stored[stored.length - 1]!.role === 'user') {
          const syntheticMsg: ModelMessage = {
            role: 'assistant',
            content: `[ant: run ended with ${outcome.status}: ${outcome.error ?? 'incomplete'}]`,
          }
          appendMessage(db, thread.id, syntheticMsg)
        }
      }

      // Record last_status and last_exit_code in threads table
      if (db) {
        try {
          db.run('UPDATE threads SET last_status = ?, last_exit_code = ?, updated_at = ? WHERE id = ?', [
            outcome.status,
            outcome.exitCode,
            Date.now(),
            thread.id,
          ])
        } catch {
          // Suppress failure here so it doesn't mask exit code
        }
      }

      // Finalize sink
      sink.finish(outcome, {
        threadId: thread.id,
        checkpoints: createdCheckpoints,
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
          hasCheckpoints: createdCheckpoints.length > 0,
          error: outcome.error,
        })
      })

      return outcome.exitCode
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logStderr(() => logger.error(message))
      return 2
    } finally {
      clearInterval(heartbeatTimer)
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
      if (db && activeThreadId) {
        try {
          releaseLease(db, activeThreadId)
        } catch {
          // ignore lease release failure on final teardown
        }
      }
      if (db) {
        try {
          db.close()
        } catch {}
      }
      lifecycle.dispose()
    }
  }
}
