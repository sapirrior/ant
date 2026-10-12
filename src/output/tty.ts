import { openSync, readSync, writeSync, closeSync } from 'node:fs'
import { createColorFormatter, type ColorLevel } from './color.ts'

export interface ConfirmPromptOptions {
  message: string
  command?: string
  reason?: string
  colorLevel?: ColorLevel
}

export function promptConfirmTTY(options: ConfirmPromptOptions): boolean {
  let fd: number | null = null
  try {
    fd = openSync('/dev/tty', 'r+')
  } catch {
    return false // No terminal available
  }

  const fmt = createColorFormatter(options.colorLevel)

  try {
    const reasonStr = options.reason ? ` ${fmt.muted(`(${options.reason})`)}` : ''
    let promptText = `${fmt.warning('?')} ${options.message}${reasonStr}\n`

    if (options.command) {
      const lines = options.command.split('\n')
      const preview = lines.slice(0, 20).join('\n')
      promptText += `  $ ${fmt.text(preview)}\n`
      if (lines.length > 20) {
        promptText += `  ${fmt.muted(`... (${lines.length - 20} more lines)`)}\n`
      }
    }

    promptText += `  ${fmt.warning('Allow? [y/N]')} `

    writeSync(fd, Buffer.from(promptText, 'utf-8'))

    const buf = Buffer.alloc(256)
    const bytesRead = readSync(fd, buf, 0, 256, null)
    const input = buf.toString('utf-8', 0, bytesRead).trim().toLowerCase()

    return input === 'y' || input === 'yes'
  } catch {
    return false
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // ignore close error
      }
    }
  }
}

export function promptAskTTY(question: string, colorLevel?: ColorLevel): string | null {
  let fd: number | null = null
  try {
    fd = openSync('/dev/tty', 'r+')
  } catch {
    return null // No terminal available
  }

  const fmt = createColorFormatter(colorLevel)

  try {
    const promptText = `\n${fmt.primary('?')} ${optionsClean(question)}\n> `
    writeSync(fd, Buffer.from(promptText, 'utf-8'))

    const buf = Buffer.alloc(4096)
    const bytesRead = readSync(fd, buf, 0, 4096, null)
    return buf.toString('utf-8', 0, bytesRead).trim()
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // ignore close error
      }
    }
  }
}

function optionsClean(str: string): string {
  return str.replace(/\r?\n/g, ' ').trim()
}
