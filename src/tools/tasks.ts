import type { ChildProcess } from 'node:child_process'

const MAX_TASK_BUFFER_CHARS = 1024 * 1024 // 1 MiB output cap

export interface ShellTask {
  id: string
  command: string
  child: ChildProcess
  startedAt: number
  status: 'running' | 'exited' | 'killed'
  exitCode: number | null
  signal: string | null
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

  createTask(command: string, child: ChildProcess): ShellTask {
    this.counter++
    const id = `t${this.counter}`
    const task: ShellTask = {
      id,
      command,
      child,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      signal: null,
      buf: '',
      droppedChars: 0,
      readCursor: 0,
      waiters: [],
    }

    const appendOutput = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
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

    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)

    child.on('close', (code, sig) => {
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
    if (task.status !== 'running') {
      throw new Error(`Cannot write to task "${id}": process is ${task.status}`)
    }
    if (!task.child.stdin || !task.child.stdin.writable) {
      throw new Error(`Cannot write to task "${id}": stdin is not writable`)
    }

    const payload = newline ? `${input}\n` : input
    task.child.stdin.write(payload)
  }

  stop(id: string, signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
    const task = this.tasks.get(id)
    if (!task) {
      throw new Error(`Task not found: "${id}"`)
    }
    if (task.status !== 'running' || !task.child.pid) {
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
      setTimeout(() => {
        if (task.status === 'killed' && task.child.pid) {
          try {
            process.kill(-task.child.pid, 'SIGKILL')
          } catch {
            // ignore
          }
        }
      }, 3000)
    }
  }

  async shutdown(graceMs = 3000): Promise<void> {
    const runningTasks: ShellTask[] = []
    for (const task of this.tasks.values()) {
      if (task.status === 'running' && task.child.pid) {
        runningTasks.push(task)
        this.stop(task.id, 'SIGTERM')
      }
    }

    if (runningTasks.length === 0) return

    const waitPromises = runningTasks.map((task) => {
      if (task.status !== 'running') return Promise.resolve()
      return new Promise<void>((resolve) => {
        const onExit = () => resolve()
        task.waiters.push(onExit)
      })
    })

    await Promise.race([
      Promise.all(waitPromises),
      new Promise<void>((resolve) => setTimeout(resolve, graceMs)),
    ])

    // Emergency kill any stubborn task
    this.killAll()
  }

  killAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'running' && task.child.pid) {
        task.status = 'killed'
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
