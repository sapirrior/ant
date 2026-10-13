import type { ModelMessage } from 'ai'
import type { Database } from 'bun:sqlite'
import { realpathSync } from 'node:fs'
import { runAgent } from './agent.ts'
import { StderrLogger } from '../output/log.ts'
import type { Config, ExitCode, RunEvent, UsageSummary } from './types.ts'
import { openDb, acquireLease, releaseLease } from '../store/db.ts'
import {
  createThread,
  getThread,
  getMessages,
  appendMessage,
  recordStepMessages,
  type ThreadRecord,
} from '../store/threads.ts'
import { recordCheckpoint } from '../store/checkpoints.ts'
import { TaskManagerRegistry } from '../tools/tasks.ts'
import { createOutputSink, StreamJsonSink } from '../output/sink.ts'
import { createLifecycle } from './lifecycle.ts'
import { repairHistory } from '../store/repair.ts'

export function setupSignalHandler(): {
  readonly controller: AbortController
  readonly cleanup: () => void
} {
  const lifecycle = createLifecycle()
  return {
    controller: lifecycle.controller,
    cleanup: () => lifecycle.dispose(),
  }
}

export class Engine {
  async run(config: Config): Promise<ExitCode> {
    const logger = new StderrLogger(config.logLevel)
    const lifecycle = createLifecycle()
    const startTime = Date.now()
    const tasks = new TaskManagerRegistry()
    const mcpManager = new (await import('../mcp/manager.ts')).McpClientManager({ cwd: config.cwd })
    const createdCheckpoints: number[] = []

    // Clamp timeout to 32-bit positive integer (Plan §2.2 / I9)
    const clampedTimeoutMs = config.timeoutMs > 0 ? Math.min(config.timeoutMs, 2_147_483_647) : 0
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    if (clampedTimeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        logger.error(`Execution timed out after ${clampedTimeoutMs}ms`)
        lifecycle.controller.abort('timeout')
      }, clampedTimeoutMs)
      timeoutTimer.unref()
    }

    let db: Database | undefined
    let activeThreadId: string | undefined

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
      db = openDb()
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
        const storedMessages = getMessages(db, thread.id)
        const repaired = repairHistory(storedMessages)
        if (repaired.repaired.length > 0) {
          logger.info(`Session history repaired on resume: ${repaired.repaired.join(', ')}`)
          // Persist repaired messages
          db.run('DELETE FROM messages WHERE thread_id = ?', [thread.id])
          let seq = 0
          for (const msg of repaired.messages) {
            seq++
            db.run('INSERT INTO messages (thread_id, seq, json) VALUES (?, ?, ?)', [
              thread.id,
              seq,
              JSON.stringify(msg),
            ])
          }
        }
        messages = repaired.messages
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
        const storedMessages = getMessages(db, thread.id)
        const repaired = repairHistory(storedMessages)
        if (repaired.repaired.length > 0) {
          logger.info(`Session history repaired on continue: ${repaired.repaired.join(', ')}`)
          db.run('DELETE FROM messages WHERE thread_id = ?', [thread.id])
          let seq = 0
          for (const msg of repaired.messages) {
            seq++
            db.run('INSERT INTO messages (thread_id, seq, json) VALUES (?, ?, ?)', [
              thread.id,
              seq,
              JSON.stringify(msg),
            ])
          }
        }
        messages = repaired.messages
        isNewThread = false
      } else {
        // Validate user instruction before creating a thread row
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

        thread = createThread(db, {
          prompt: config.prompt,
          stdinInput: config.stdinInput,
          cwd: realCwd,
          model: config.model,
        })
        activeThreadId = thread.id
        acquireLease(db, thread.id)

        const userMessage: ModelMessage = {
          role: 'user',
          content: userContent,
        }
        appendMessage(db, thread.id, userMessage)
        messages.push(userMessage)
      }

      if (!isNewThread) {
        let userContent = ''
        if (config.prompt && config.stdinInput) {
          userContent = `${config.prompt}\n\n[Piped Input]:\n${config.stdinInput}`
        } else if (config.prompt) {
          userContent = config.prompt
        } else if (config.stdinInput) {
          userContent = config.stdinInput
        }

        if (userContent) {
          const userMessage: ModelMessage = {
            role: 'user',
            content: userContent,
          }
          appendMessage(db, thread.id, userMessage)
          messages.push(userMessage)
        } else {
          // If continuing/resuming without an additional prompt, ensure conversation ends in a user turn
          const lastMsg = messages[messages.length - 1]
          if (!lastMsg || lastMsg.role !== 'user') {
            const continueMessage: ModelMessage = {
              role: 'user',
              content: 'Continue where you left off.',
            }
            appendMessage(db, thread.id, continueMessage)
            messages.push(continueMessage)
          }
        }
      }

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

      // Create OutputSink according to outputFormat
      const isStdoutTTY = Boolean(process.stdout.isTTY)
      const sink = createOutputSink({
        format: config.outputFormat,
        isStdoutTTY,
        threadId: thread.id,
        checkpoints: createdCheckpoints,
        model: config.model,
        effort: config.effort,
        startTime,
      })

      const activeToolsList: string[] = []
      if (config.grants.has('fs.read')) {
        activeToolsList.push('ReadFile', 'ListDir', 'Grep')
      }
      if (config.grants.has('fs.write')) {
        activeToolsList.push('WriteFile', 'EditFile', 'DeleteFile')
      }
      if (config.grants.has('shell.run')) {
        activeToolsList.push('Bash', 'TaskManager')
      }
      activeToolsList.push('WebSearch', 'WebFetch')

      if (sink instanceof StreamJsonSink) {
        sink.emitInit({
          threadId: thread.id,
          model: config.model,
          cwd: config.cwd,
          effort: config.effort ?? null,
          grants: allowedCaps,
          tools: activeToolsList,
          resumed: !isNewThread,
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
          onStepPersist: (stepMessages: ModelMessage[], usage?: UsageSummary) => {
            // Atomic step message and usage persistence (Plan §2.5 / I1)
            recordStepMessages(db!, thread.id, stepMessages, 1, usage)
          },
        },
        onCheckpoint: (tool, toolCallId, files) => {
          const seq = recordCheckpoint(db!, thread.id, tool, toolCallId, files)
          createdCheckpoints.push(seq)
          return seq
        },
        onEvent: (event: RunEvent) => {
          sink.onEvent(event)

          switch (event.type) {
            case 'tool-call': {
              let summary: string | undefined
              if (typeof event.input === 'object' && event.input !== null) {
                const obj = event.input as Record<string, unknown>
                if (event.toolName === 'McpTool') {
                  if (obj.action === 'list_servers') summary = 'list_servers'
                  else if (obj.action === 'list_tools') summary = `list_tools (${obj.server})`
                  else if (obj.action === 'call') summary = `call ${obj.server}/${obj.tool}`
                } else if (typeof obj.path === 'string') summary = obj.path
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

      // Record last_status and last_exit_code in threads table (Migration 2 / Plan §2.5)
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

      // Finalize sink
      sink.finish(outcome, {
        threadId: thread.id,
        checkpoints: createdCheckpoints,
        model: config.model,
        effort: config.effort,
        startTime,
      })

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
