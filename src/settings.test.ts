import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSettings,
  saveSettings,
  parseDurationMs,
  KEYS,
  withFileLock,
  getSettingsLockPath,
  VALID_REASONING,
  type Settings,
} from './settings.ts'

describe('settings module', () => {
  let testHome: string
  const originalAntHome = process.env.ANT_HOME

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'ant-settings-test-'))
    process.env.ANT_HOME = testHome
  })

  afterEach(() => {
    process.env.ANT_HOME = originalAntHome
    rmSync(testHome, { recursive: true, force: true })
  })

  it('parses duration strings correctly', () => {
    expect(parseDurationMs('1000')).toBe(1000)
    expect(() => parseDurationMs('100')).toThrow(/did you mean "100s"\?/i)
    expect(parseDurationMs('500ms')).toBe(500)
    expect(parseDurationMs('10s')).toBe(10000)
    expect(parseDurationMs('2.5s')).toBe(2500)
    expect(parseDurationMs('5m')).toBe(300000)
    expect(parseDurationMs('1h')).toBe(3600000)
    expect(() => parseDurationMs('invalid')).toThrow(/Invalid duration format/)
  })

  it('returns empty object when settings.json does not exist', () => {
    expect(loadSettings()).toEqual({})
  })

  it('saves and loads settings round-trip', () => {
    const s: Settings = {
      model: 'google/gemini-2.5-flash',
      maxSteps: 25,
      timeout: '15m',
      allowedTools: ['Bash(bun test *)'],
    }
    saveSettings(s)
    const loaded = loadSettings()
    expect(loaded.model).toBe('google/gemini-2.5-flash')
    expect(loaded.maxSteps).toBe(25)
    expect(loaded.timeout).toBe('15m')
    expect(loaded.allowedTools).toEqual(['Bash(bun test *)'])
  })

  it('fails with clear error on malformed JSON', () => {
    const settingsPath = join(testHome, 'settings.json')
    writeFileSync(settingsPath, '{ invalid json', 'utf-8')
    expect(() => loadSettings()).toThrow(/malformed JSON/)
  })

  it('warns on unknown keys and ignores them', () => {
    const settingsPath = join(testHome, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ unknownKey: 'value', maxSteps: 10 }), 'utf-8')
    const loaded = loadSettings()
    expect(loaded.maxSteps).toBe(10)
  })

  it('strictly validates and parses settings keys in KEYS table', () => {
    expect(KEYS['maxSteps']!.parse('15')).toBe(15)
    expect(() => KEYS['maxSteps']!.parse('-5')).toThrow(/positive integer/)
    expect(() => KEYS['maxSteps']!.parse('abc')).toThrow(/positive integer/)

    expect(KEYS['output']!.parse('text')).toBe('text')
    expect(KEYS['output']!.parse('md')).toBe('md')
    expect(KEYS['output']!.parse('json')).toBe('json')
    expect(KEYS['output']!.parse('stream-json')).toBe('stream-json')
    expect(() => KEYS['output']!.parse('yaml')).toThrow(/must be "text", "md", "json", or "stream-json"/)

    for (const val of VALID_REASONING) {
      expect(KEYS['reasoning']!.parse(val)).toBe(val)
    }
    expect(KEYS['reasoning']!.parse('default')).toBe('provider-default')
    expect(() => KEYS['reasoning']!.parse('super-high')).toThrow(/must be one of/)

    expect(KEYS['permissionMode']!.parse('default')).toBe('default')
    expect(KEYS['permissionMode']!.parse('plan')).toBe('plan')
    expect(KEYS['permissionMode']!.parse('acceptEdits')).toBe('acceptEdits')
    expect(KEYS['permissionMode']!.parse('bypassPermissions')).toBe('bypassPermissions')
    expect(() => KEYS['permissionMode']!.parse('auto')).toThrow(/must be/)
    expect(() => KEYS['permissionMode']!.parse('invalid')).toThrow(/must be/)

    expect(KEYS['allowedTools']!.parse('Bash, ReadFile')).toEqual(['Bash', 'ReadFile'])
    expect(KEYS['disallowedTools']!.parse('Bash(rm *)')).toEqual(['Bash(rm *)'])
  })

  it('survives concurrent writes with withFileLock', async () => {
    const lockPath = getSettingsLockPath()
    const tasks = Array.from({ length: 5 }, (_, i) => async () => {
      await withFileLock(lockPath, async () => {
        const current = loadSettings()
        KEYS[`tools.Bash.passEnv`]!.set(current, [`VAR_${i}`])
        saveSettings(current)
      })
    })

    await Promise.all(tasks.map((t) => t()))
    expect(existsSync(join(testHome, 'settings.json'))).toBe(true)
  })

  it('recognizes reasoning and effort without warning', () => {
    const settingsPath = join(testHome, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ reasoning: 'high', effort: 'medium' }), 'utf-8')
    const warnings: string[] = []
    const loaded = loadSettings({ warn: (w) => warnings.push(w) })
    expect(loaded.reasoning).toBe('high')
    expect(warnings.length).toBe(0)
  })

  it('routes warnings through custom warn callback and warns on deprecated allow/deny', () => {
    const settingsPath = join(testHome, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ allow: { read: true }, deny: { mcp: [] }, invalidRandomKey: 123 }), 'utf-8')
    const warnings: string[] = []
    loadSettings({ warn: (w) => warnings.push(w) })
    expect(warnings.some((w) => w.includes('invalidRandomKey'))).toBe(true)
    expect(warnings.some((w) => w.includes('ignoring deprecated setting "allow"'))).toBe(true)
    expect(warnings.some((w) => w.includes('ignoring deprecated setting "deny"'))).toBe(true)
  })

  it('keeps output unset by default when settings file exists', () => {
    const settingsPath = join(testHome, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ maxSteps: 15 }), 'utf-8')
    const loaded = loadSettings()
    expect(loaded.output).toBeUndefined()
  })

  it('recognizes output setting without warning', () => {
    const settingsPath = join(testHome, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ output: 'md' }), 'utf-8')
    const warnings: string[] = []
    const loaded = loadSettings({ warn: (w) => warnings.push(w) })
    expect(warnings.length).toBe(0)
    expect(loaded.output).toBe('md')
  })
})
