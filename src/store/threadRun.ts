import type { Database } from 'bun:sqlite'
import type { ModelMessage } from 'ai'
import type { Config, ModelOutcome, UsageSummary } from '../core/types.ts'
import { openDb, acquireLease, releaseLease } from './db.ts'
import {
  createThread,
  getThread,
  getMessages,
  appendMessage,
  appendMessages,
  recordStepMessages,
  type ThreadRecord,
} from './threads.ts'
import { repairHistory } from './repair.ts'
import { recordCheckpoint } from './checkpoints.ts'
import type { FileSnapshot } from '../tools/fs.ts'

export interface ThreadRunOptions {
  readonly config: Config
  readonly realCwd: string
  readonly onLog?: (message: string) => void
}

export class ThreadRun {
  readonly db: Database | null
  readonly thread: ThreadRecord
  readonly isNewThread: boolean
  readonly modelMismatchOld?: string
  readonly initialMessages: ModelMessage[]
  readonly createdCheckpoints: number[] = []

  private heartbeatTimer?: Timer
  private isClosed = false

  private constructor(params: {
    db: Database | null
    thread: ThreadRecord
    isNewThread: boolean
    modelMismatchOld?: string
    initialMessages: ModelMessage[]
  }) {
    this.db = params.db
    this.thread = params.thread
    this.isNewThread = params.isNewThread
    this.modelMismatchOld = params.modelMismatchOld
    this.initialMessages = params.initialMessages
  }

  static open(options: ThreadRunOptions): ThreadRun {
    const { config, realCwd, onLog } = options
    const isPersistent = !config.noSessionPersistence
    const db = isPersistent ? openDb() : null

    let thread: ThreadRecord
    let messages: ModelMessage[] = []
    let isNewThread = true
    let modelMismatchOld: string | undefined

    const existingThreadId = config.resumeThreadId ?? (config.continueLatest ? 'latest' : undefined)

    const buildUserContent = () => {
      if (config.prompt && config.stdinInput) {
        return `${config.prompt}\n\n[Piped Input]:\n${config.stdinInput}`
      }
      return config.prompt || config.stdinInput || undefined
    }

    if (existingThreadId) {
      if (!db) {
        throw new Error('Cannot resume thread when persistence is disabled')
      }
      const t = getThread(db, existingThreadId, realCwd)
      if (t.cwd !== realCwd) {
        throw new Error(`thread belongs to ${t.cwd}; cd there first`)
      }
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
        onLog?.(`Session history repaired: ${repaired.repaired.join(', ')}`)
        const tail = repaired.messages.slice(storedMessages.length)
        if (tail.length > 0) {
          appendMessages(db, t.id, tail)
        }
      }

      thread = t
      messages = [...repaired.messages]
      isNewThread = false

      const userContent = buildUserContent()
      if (userContent) {
        const userMessage: ModelMessage = {
          role: 'user',
          content: userContent,
        }
        appendMessage(db, thread.id, userMessage)
        messages.push(userMessage)
      } else {
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
    } else {
      const userContent = buildUserContent()
      if (!userContent) {
        throw new Error(
          'No instruction provided. Pass a prompt via -p "..." or pipe input via stdin.',
        )
      }

      if (isPersistent && db) {
        thread = createThread(db, {
          prompt: config.prompt,
          stdinInput: config.stdinInput,
          cwd: realCwd,
          model: config.model,
        })
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

    const instance = new ThreadRun({
      db,
      thread,
      isNewThread,
      modelMismatchOld,
      initialMessages: messages,
    })

    if (db && thread.id !== 'ephemeral') {
      instance.heartbeatTimer = setInterval(() => {
        try {
          if (!instance.isClosed) {
            acquireLease(db, thread.id)
          }
        } catch {}
      }, 5000)
    }

    return instance
  }

  recordStep(stepMessages: ModelMessage[], usage?: UsageSummary, stepsIncrement = 1): void {
    if (this.db && this.thread.id !== 'ephemeral') {
      recordStepMessages(this.db, this.thread.id, stepMessages, stepsIncrement, usage)
    }
  }

  recordCheckpoint(
    tool: string,
    toolCallId: string | undefined,
    files: { path: string; before: FileSnapshot | null; after: FileSnapshot | null }[],
  ): number {
    if (this.db && this.thread.id !== 'ephemeral') {
      const seq = recordCheckpoint(this.db, this.thread.id, tool, toolCallId, files)
      this.createdCheckpoints.push(seq)
      return seq
    }
    return 0
  }

  finalizeOutcome(outcome: ModelOutcome): void {
    if (!this.db || this.thread.id === 'ephemeral') return

    if (outcome.status !== 'completed' && !outcome.text) {
      const stored = getMessages(this.db, this.thread.id)
      if (stored.length > 0 && stored[stored.length - 1]!.role === 'user') {
        const syntheticMsg: ModelMessage = {
          role: 'assistant',
          content: `[ant: run ended with ${outcome.status}: ${outcome.error ?? 'incomplete'}]`,
        }
        appendMessage(this.db, this.thread.id, syntheticMsg)
      }
    }

    try {
      this.db.run(
        'UPDATE threads SET last_status = ?, last_exit_code = ?, updated_at = ? WHERE id = ?',
        [outcome.status, outcome.exitCode, Date.now(), this.thread.id],
      )
    } catch {}
  }

  close(): void {
    if (this.isClosed) return
    this.isClosed = true

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }

    if (this.db) {
      if (this.thread.id !== 'ephemeral') {
        try {
          releaseLease(this.db, this.thread.id)
        } catch {}
      }
      try {
        this.db.close()
      } catch {}
    }
  }
}
