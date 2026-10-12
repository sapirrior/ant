import type { OutputFormat } from '../types/config.ts'
import type { ModelOutcome } from '../types/run.ts'

export function renderOutcome(outcome: ModelOutcome, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(
        {
          status: outcome.status,
          exitCode: outcome.exitCode,
          text: outcome.text,
          stepsExecuted: outcome.stepsExecuted,
          usage: outcome.usage,
          error: outcome.error,
        },
        null,
        2
      )

    case 'md':
    case 'text':
      // In text/md mode: if run failed without completion, stdout stays empty (error goes to stderr)
      if (outcome.status !== 'completed' && outcome.text.trim().length === 0) {
        return ''
      }
      return outcome.text
  }
}
