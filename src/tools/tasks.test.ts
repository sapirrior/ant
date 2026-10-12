import { describe, expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import { TaskManagerRegistry } from './tasks.ts'

describe('TaskManagerRegistry and background processes', () => {
  it('tracks spawned processes, captures output, and reads with cursor', async () => {
    const registry = new TaskManagerRegistry()
    const child = spawn('/bin/sh', ['-c', 'echo "hello from task"; echo "second line"'])
    const task = registry.createTask('echo test', child)

    expect(task.id).toBe('t1')
    expect(task.command).toBe('echo test')

    // Wait briefly for execution
    await new Promise((resolve) => setTimeout(resolve, 100))

    const read1 = await registry.read('t1')
    expect(read1.output).toContain('hello from task')
    expect(read1.output).toContain('second line')

    // Subsequent read returns empty because cursor advanced
    const read2 = await registry.read('t1')
    expect(read2.output).toBe('')
  })

  it('lists active and completed tasks with metadata', async () => {
    const registry = new TaskManagerRegistry()
    const child = spawn('/bin/sh', ['-c', 'exit 0'])
    registry.createTask('exit 0', child)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const list = registry.list()
    expect(list.length).toBe(1)
    expect(list[0]?.id).toBe('t1')
    expect(list[0]?.command).toBe('exit 0')
  })

  it('writes to task stdin and captures response', async () => {
    const registry = new TaskManagerRegistry()
    const child = spawn('cat', [], { stdio: ['pipe', 'pipe', 'pipe'] })
    const task = registry.createTask('cat', child)

    registry.write(task.id, 'hello cat', true)

    // Wait for cat to echo to stdout
    await new Promise((resolve) => setTimeout(resolve, 100))

    const read = await registry.read(task.id)
    expect(read.output).toContain('hello cat')

    registry.stop(task.id, 'SIGKILL')
  })

  it('stops running tasks and killAll terminates all active tasks', async () => {
    const registry = new TaskManagerRegistry()
    const child1 = spawn('sleep', ['60'])
    const child2 = spawn('sleep', ['60'])

    const t1 = registry.createTask('sleep 1', child1)
    const t2 = registry.createTask('sleep 2', child2)

    expect(t1.status).toBe('running')
    expect(t2.status).toBe('running')

    registry.killAll()

    expect(t1.status).toBe('killed')
    expect(t2.status).toBe('killed')
  })
})
