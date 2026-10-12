import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { ModelMessage } from 'ai'

export function getAntHome(): string {
  return process.env.ANT_HOME ?? join(homedir(), '.ant')
}

export function getThreadsDirectory(): string {
  return join(getAntHome(), 'threads')
}

export async function ensureThreadsDirectory(): Promise<string> {
  const dir = getThreadsDirectory()
  await mkdir(dir, { recursive: true })
  return dir
}

export function generateThreadId(): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const random = randomBytes(4).toString('hex')
  return `th_${timestamp}_${random}`
}

export async function getLatestThreadId(): Promise<string | undefined> {
  const latestPath = join(getThreadsDirectory(), 'latest')
  if (!existsSync(latestPath)) {
    return undefined
  }
  const content = await readFile(latestPath, 'utf-8')
  return content.trim() || undefined
}

export async function setLatestThreadId(threadId: string): Promise<void> {
  await ensureThreadsDirectory()
  const latestPath = join(getThreadsDirectory(), 'latest')
  await writeFile(latestPath, threadId.trim(), 'utf-8')
}

export async function loadThread(threadId: string): Promise<ModelMessage[]> {
  const filePath = join(getThreadsDirectory(), `${threadId}.json`)
  if (!existsSync(filePath)) {
    throw new Error(`Thread not found: "${threadId}" at ${filePath}`)
  }

  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw) as ModelMessage[]
}

export async function saveThread(threadId: string, messages: readonly ModelMessage[]): Promise<void> {
  await ensureThreadsDirectory()
  const filePath = join(getThreadsDirectory(), `${threadId}.json`)
  await writeFile(filePath, JSON.stringify(messages, null, 2), 'utf-8')
  await setLatestThreadId(threadId)
}
