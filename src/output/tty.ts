import { openSync, closeSync } from 'node:fs'
import fs from 'node:fs'
import readline from 'node:readline'
import { createColorFormatter, getSymbols, type ColorLevel, type ThemeMode } from './color.ts'
import { collapseInline } from '../utils/format.ts'

export interface ConfirmPromptOptions {
  message: string
  command?: string
  reason?: string
  colorLevel?: ColorLevel
  theme?: ThemeMode
  signal?: AbortSignal
}

export function hasControllingTTY(): boolean {
  try {
    const fd = openSync('/dev/tty', 'r+')
    closeSync(fd)
    return true
  } catch {
    return false
  }
}

export async function promptConfirmTTY(options: ConfirmPromptOptions): Promise<boolean> {
  let stream: fs.ReadStream
  try {
    stream = fs.createReadStream('/dev/tty')
  } catch {
    return false // No terminal available
  }

  const fmt = createColorFormatter(options.colorLevel, options.theme)
  const sym = getSymbols()
  const reasonStr = options.reason ? ` ${fmt.muted(`(${options.reason})`)}` : ''
  let promptText = `${fmt.warning(sym.prompt)} ${options.message}${reasonStr}\n`

  if (options.command) {
    const lines = options.command.split('\n')
    const displayLines = lines.slice(0, 20)
    const rail = fmt.muted(sym.rail)

    displayLines.forEach((l, idx) => {
      const sanitized = collapseInline(l, 100)
      if (idx === 0) {
        promptText += `  ${rail} $ ${fmt.text(sanitized)}\n`
      } else {
        promptText += `  ${rail}   ${fmt.text(sanitized)}\n`
      }
    })

    if (lines.length > 20) {
      promptText += `  ${rail} ${fmt.muted(`... (${lines.length - 20} more lines)`)}\n`
    }
  }

  promptText += `  ${fmt.warning('Allow? [y/N]')} `
  process.stderr.write(promptText)

  const rl = readline.createInterface({
    input: stream,
    output: process.stderr,
    terminal: true,
  })

  return new Promise<boolean>((resolve) => {
    let resolved = false
    const done = (val: boolean) => {
      if (!resolved) {
        resolved = true
        rl.close()
        stream.destroy()
        resolve(val)
      }
    }

    if (options.signal?.aborted) {
      done(false)
      return
    }

    const abortHandler = () => done(false)
    options.signal?.addEventListener('abort', abortHandler, { once: true })

    const timeoutMs = Number(process.env.ANT_CONFIRM_TIMEOUT_MS) || 60_000
    const timer = setTimeout(() => done(false), timeoutMs)
    timer.unref()

    rl.on('line', (line) => {
      clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener('abort', abortHandler)
      const input = line.trim().toLowerCase()
      done(input === 'y' || input === 'yes')
    })

    rl.on('close', () => {
      clearTimeout(timer)
      done(false)
    })
  })
}

