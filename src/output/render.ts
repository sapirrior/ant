import type { OutputFormat, ModelOutcome } from '../core/types.ts'
import { renderMarkdown } from './markdown.ts'
import { detectColorLevel, type ColorLevel } from './color.ts'

export interface RenderOptions {
  format: OutputFormat
  threadId?: string
  checkpoints?: number[]
  colorLevel?: ColorLevel
}

export function renderOutcome(
  outcome: ModelOutcome,
  options: RenderOptions
): string {
  if (options.format === 'json') {
    return (
      JSON.stringify(
        {
          status: outcome.status,
          exitCode: outcome.exitCode,
          text: outcome.text,
          threadId: options.threadId ?? null,
          steps: outcome.stepsExecuted,
          usage: outcome.usage
            ? {
                inputTokens: outcome.usage.inputTokens ?? 0,
                outputTokens: outcome.usage.outputTokens ?? 0,
                totalTokens: outcome.usage.totalTokens ?? 0,
              }
            : null,
          checkpoints: options.checkpoints ?? [],
          error: outcome.error ?? null,
        },
        null,
        2
      ) + '\n'
    )
  }

  if (outcome.status !== 'completed' && outcome.text.trim().length === 0) {
    return ''
  }

  // md format: formatted markdown with smart wrapping and syntax highlighting
  if (options.format === 'md') {
    const isStdoutTTY = Boolean(process.stdout.isTTY)
    const colorLevel = options.colorLevel ?? detectColorLevel(process.env, isStdoutTTY)
    const formatted = renderMarkdown(outcome.text, { colorLevel })
    return formatted.endsWith('\n') ? formatted : `${formatted}\n`
  }

  // text format: raw unformatted text
  return outcome.text.endsWith('\n') ? outcome.text : `${outcome.text}\n`
}

export function writeStdout(content: string): void {
  if (content.length === 0) return
  process.stdout.write(content)
}
