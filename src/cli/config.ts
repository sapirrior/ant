import { Command } from 'commander'
import {
  getSettingsPath,
  getSettingsLockPath,
  loadSettings,
  saveSettings,
  withFileLock,
  KEYS,
  type Settings,
} from '../settings.ts'
import { notice } from '../output/notice.ts'

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
    .command('path')
    .description('Print the path to settings.json')
    .action(() => {
      process.stdout.write(`${getSettingsPath()}\n`)
      process.exitCode = 0
    })

  configCmd
    .command('get <key>')
    .description('Get the value of a setting from ~/.ant/settings.json')
    .action((key: string) => {
      const keyDef = KEYS[key]
      if (!keyDef) {
        notice.error(`Unknown setting "${key}".`)
        process.exitCode = 2
        return
      }

      const current = loadSettings()
      const val = keyDef.get(current)
      if (val === undefined) {
        notice.info(`Setting "${key}" is not set.`)
        process.exitCode = 1
        return
      } else if (typeof val === 'object' && val !== null) {
        process.stdout.write(`${JSON.stringify(val, null, 2)}\n`)
      } else {
        process.stdout.write(`${val}\n`)
      }
      process.exitCode = 0
    })

  configCmd
    .command('set <key> <value>')
    .description('Set a setting in ~/.ant/settings.json')
    .action(async (key: string, value: string) => {
      const keyDef = KEYS[key]
      if (!keyDef) {
        notice.error(`Unknown setting "${key}".`)
        process.exitCode = 2
        return
      }

      let parsedVal: unknown
      try {
        parsedVal = keyDef.parse(value)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        notice.error(msg)
        process.exitCode = 2
        return
      }

      const lockPath = getSettingsLockPath()
      try {
        await withFileLock(lockPath, () => {
          const current: Settings = loadSettings()
          keyDef.set(current, parsedVal)
          saveSettings(current)
        })
        process.stdout.write(`Updated ${key} = ${value} in ${getSettingsPath()}\n`)
        process.exitCode = 0
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        notice.error(`Failed to update settings: ${msg}`)
        process.exitCode = 2
      }
    })

  configCmd
    .command('unset <key>')
    .description('Unset a setting in ~/.ant/settings.json')
    .action(async (key: string) => {
      const keyDef = KEYS[key]
      if (!keyDef) {
        notice.error(`Unknown setting "${key}".`)
        process.exitCode = 2
        return
      }

      const lockPath = getSettingsLockPath()
      try {
        await withFileLock(lockPath, () => {
          const current: Settings = loadSettings()
          keyDef.unset(current)
          saveSettings(current)
        })
        process.stdout.write(`Unset ${key} in ${getSettingsPath()}\n`)
        process.exitCode = 0
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        notice.error(`Failed to unset setting: ${msg}`)
        process.exitCode = 2
      }
    })
}
