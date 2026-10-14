import type { ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

const MAX_TASK_BUFFER_CHARS = 1024 * 1024 // 1 MiB output cap

export interface ShellTask {
  id: string
  command: string
  child: ChildProcess
  startedAt: number
  status: 'running' | 'exited' | 'killed'
  exitCode: number | null
  signal: string | null
  exited: boolean
  stdinClosed?: boolean
  escalationTimer?: ReturnType<typeof setTimeout>
  hardTimer?: ReturnType<typeof setTimeout> | null
  buf: string
  droppedChars: number
  readCursor: number
  waiters: (() => void)[]
}

export interface TaskSummary {
  id: string
  command: string
  status: 'running' | 'exited' | 'killed'
  exitCode: number | null
  runtimeMs: number
  unreadChars: number
}

export class TaskManagerRegistry {
  private tasks = new Map<string, ShellTask>()
  private counter = 0

  createTask(command: string, child: ChildProcess, initialBuffer = ''): ShellTask {
    this.counter++
    const id = `t${this.counter}`
    const isExited = child.exitCode !== null || child.signalCode !== null
    const task: ShellTask = {
      id,
      command,
      child,
      startedAt: Date.now(),
      status: isExited ? 'exited' : 'running',
      exitCode: child.exitCode,
      signal: child.signalCode,
      exited: isExited,
      stdinClosed: false,
      buf: initialBuffer,
      droppedChars: 0,
      readCursor: 0,
      waiters: [],
    }

    child.stdin?.on('error', () => {
      task.stdinClosed = true
    })

    const stdoutDecoder = new StringDecoder('utf-8')
    const stderrDecoder = new StringDecoder('utf-8')

    const appendStdout = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk)
      task.buf += text
      if (task.buf.length > MAX_TASK_BUFFER_CHARS) {
        const excess = task.buf.length - MAX_TASK_BUFFER_CHARS
        task.droppedChars += excess
        task.buf = task.buf.slice(excess)
        task.readCursor = Math.max(0, task.readCursor - excess)
      }
      for (const w of task.waiters) {
        w()
      }
      task.waiters = []
    }

    const appendStderr = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk)
      task.buf += text
      if (task.buf.length > MAX_TASK_BUFFER_CHARS) {
        const excess = task.buf.length - MAX_TASK_BUFFER_CHARS
        task.droppedChars += excess
        task.buf = task.buf.slice(excess)
        task.readCursor = Math.max(0, task.readCursor - excess)
      }
      for (const w of task.waiters) {
        w()
      }
      task.waiters = []
    }

    child.stdout?.on('data', appendStdout)
    child.stderr?.on('data', appendStderr)

    child.on('close', (code, sig) => {
      task.exited = true
      task.stdinClosed = true
      if (task.escalationTimer) {
        clearTimeout(task.escalationTimer)
        task.escalationTimer = undefined
      }
      if (task.hardTimer) {
        clearTimeout(task.hardTimer)
        task.hardTimer = null
      }
      task.status = task.status === 'killed' ? 'killed' : 'exited'
      task.exitCode = code
      task.signal = sig
      for (const w of task.waiters) {
        w()
      }
      task.waiters = []
    })

    this.tasks.set(id, task)
    return task
  }

  getTask(id: string): ShellTask | undefined {
    return this.tasks.get(id)
  }

  list(): TaskSummary[] {
    const out: TaskSummary[] = []
    for (const task of this.tasks.values()) {
      const commandPreview = task.command.length > 100 ? `${task.command.slice(0, 97)}...` : task.command
      const unreadChars = Math.max(0, task.buf.length - task.readCursor)
      out.push({
        id: task.id,
        command: commandPreview,
        status: task.status,
        exitCode: task.exitCode,
        runtimeMs: Date.now() - task.startedAt,
        unreadChars,
      })
    }
    return out
  }

  async read(
    id: string,
    waitMs = 0
  ): Promise<{
    output: string
    moreAvailable: boolean
    droppedChars: number
    status: string
    exitCode: number | null
  }> {
    const task = this.tasks.get(id)
    if (!task) {
      throw new Error(`Task not found: "${id}"`)
    }

    if (task.readCursor >= task.buf.length && task.status === 'running' && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          resolve()
        }, waitMs)
        task.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }

    const available = task.buf.slice(task.readCursor, task.readCursor + 30000)
    task.readCursor += available.length
    const moreAvailable = task.readCursor < task.buf.length

    return {
      output: available,
      moreAvailable,
      droppedChars: task.droppedChars,
      status: task.status,
      exitCode: task.exitCode,
    }
  }

  write(id: string, input: string, newline = true): void {
    const task = this.tasks.get(id)
    if (!task) {
      throw new Error(`Task not found: "${id}"`)
    }
    if (task.exited || task.status !== 'running' || task.stdinClosed || !task.child.stdin || !task.child.stdin.writable || task.child.stdin.destroyed || task.child.stdin.writableEnded) {
      throw new Error(`Cannot write to task "${id}": stdin is not writable or process has exited`)
    }

    const payload = newline ? `${input}\n` : input
    try {
      task.child.stdin.write(payload, (err) => {
        if (err) task.stdinClosed = true
      })
    } catch {
      task.stdinClosed = true
      throw new Error(`Cannot write to task "${id}": stdin stream closed`)
    }
  }

  stop(id: string, signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
    const task = this.tasks.get(id)
    if (!task) {
      throw new Error(`Task not found: "${id}"`)
    }
    if (task.exited || !task.child.pid || task.child.exitCode !== null || task.child.signalCode !== null) {
      return
    }

    task.status = 'killed'
    try {
      // Kill process group
      process.kill(-task.child.pid, signal)
    } catch {
      try {
        task.child.kill(signal)
      } catch {
        // ignore
      }
    }

    // Auto-escalate to SIGKILL if SIGTERM doesn't kill within 3s
    if (signal === 'SIGTERM') {
      if (task.escalationTimer) clearTimeout(task.escalationTimer)
      task.escalationTimer = setTimeout(() => {
        if (!task.exited && task.child.pid && task.child.exitCode === null && task.child.signalCode === null) {
          try {
            process.kill(-task.child.pid, 'SIGKILL')
          } catch {
            try {
              task.child.kill('SIGKILL')
            } catch {}
          }
        }
      }, 3000)
      task.escalationTimer.unref()
    }
  }

  async shutdown(graceMs = 3000): Promise<void> {
    const pendingTasks: ShellTask[] = []
    for (const task of this.tasks.values()) {
      if (!task.exited && task.child.pid && task.child.exitCode === null && task.child.signalCode === null) {
        pendingTasks.push(task)
        this.stop(task.id, 'SIGTERM')
      }
    }

    if (pendingTasks.length === 0) return

    const waitPromises = pendingTasks.map((task) => {
      if (task.exited || task.child.exitCode !== null || task.child.signalCode !== null) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        const onExit = () => resolve()
        task.waiters.push(onExit)
      })
    })

    const timeout = new Promise<void>((resolve) => {
      const t = setTimeout(resolve, graceMs)
      t.unref()
    })

    await Promise.race([Promise.all(waitPromises), timeout])

    // Emergency kill any stubborn task
    this.killAll()
  }

  killAll(): void {
    for (const task of this.tasks.values()) {
      if (!task.exited && task.child.pid && task.child.exitCode === null && task.child.signalCode === null) {
        task.status = 'killed'
        if (task.escalationTimer) {
          clearTimeout(task.escalationTimer)
          task.escalationTimer = undefined
        }
        if (task.hardTimer) {
          clearTimeout(task.hardTimer)
          task.hardTimer = null
        }
        try {
          process.kill(-task.child.pid, 'SIGKILL')
        } catch {
          try {
            task.child.kill('SIGKILL')
          } catch {
            // ignore
          }
        }
      }
    }
  }
}
