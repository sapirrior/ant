import { Command } from 'commander'
import type { LogLevel, OutputFormat } from '../core/types.ts'
import {
  getSettingsPath,
  loadSettings,
  parseDurationMs,
  saveSettings,
  validateModelString,
  type UserSettings,
} from '../settings.ts'

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('View and update persistent settings in ~/.ant/settings.json')
    .action(() => {
      const current = loadSettings()
      const settingsPath = getSettingsPath()
      process.stdout.write(`Settings (${settingsPath}):\n${JSON.stringify(current, null, 2)}\n`)
      process.exitCode = 0
    })

  configCmd
    .command('get <key>')
    .description('Get the value of a setting from ~/.ant/settings.json')
    .action((key: string) => {
      const current = loadSettings()
      const val = (current as Record<string, unknown>)[key]
      if (val === undefined) {
        process.stderr.write(`[ant] Key "${key}" is not set.\n`)
      } else {
        process.stdout.write(`${val}\n`)
      }
      process.exitCode = 0
    })

  configCmd
    .command('set <key> <value>')
    .description('Set a setting in ~/.ant/settings.json')
    .action((key: string, value: string) => {
      const current = loadSettings()
      const settingsPath = getSettingsPath()
      const updated: Record<string, unknown> = { ...current }

      switch (key) {
        case 'model':
          validateModelString(value)
          updated.model = value
          break
        case 'maxSteps': {
          const num = Number.parseInt(value, 10)
          if (Number.isNaN(num) || num <= 0) {
            process.stderr.write('[ant] error: maxSteps must be a positive integer.\n')
            process.exitCode = 2
            return
          }
          updated.maxSteps = num
          break
        }
        case 'timeout':
          parseDurationMs(value)
          updated.timeout = value
          break
        case 'outputFormat':
          if (value !== 'text' && value !== 'md' && value !== 'json') {
            process.stderr.write('[ant] error: outputFormat must be text, md, or json.\n')
            process.exitCode = 2
            return
          }
          updated.outputFormat = value as OutputFormat
          break
        case 'logLevel':
          if (value !== 'error' && value !== 'info' && value !== 'debug') {
            process.stderr.write('[ant] error: logLevel must be error, info, or debug.\n')
            process.exitCode = 2
            return
          }
          updated.logLevel = value as LogLevel
          break
        case 'allowRead':
        case 'allowEdit':
        case 'allowBash':
        case 'allowDestructiveBash':
          updated[key] = value === 'true' || value === '1'
          break
        default:
          process.stderr.write(`[ant] error: Unknown setting "${key}".\n`)
          process.exitCode = 2
          return
      }

      saveSettings(updated as UserSettings)
      process.stdout.write(`Updated ${key} = ${value} in ${settingsPath}\n`)
      process.exitCode = 0
    })
}
