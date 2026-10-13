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
    expect(parseDurationMs('100')).toBe(100)
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
      allow: { read: true, edit: false },
    }
    saveSettings(s)
    const loaded = loadSettings()
    expect(loaded.model).toBe('google/gemini-2.5-flash')
    expect(loaded.maxSteps).toBe(25)
    expect(loaded.timeout).toBe('15m')
    expect(loaded.allow?.read).toBe(true)
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

    expect(KEYS['reasoning']!.parse('low')).toBe('low')
    expect(KEYS['reasoning']!.parse('max')).toBe('max')
    expect(KEYS['reasoning']!.parse('default')).toBe('provider-default')
    expect(KEYS['effort']!.parse('minimal')).toBe('minimal')
    expect(() => KEYS['reasoning']!.parse('super-high')).toThrow(/must be one of/)

    expect(KEYS['allow.read']!.parse('true')).toBe(true)
    expect(KEYS['allow.read']!.parse('false')).toBe(false)
    expect(() => KEYS['allow.read']!.parse('yes')).toThrow(/must be true or false/)
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

  it('recognizes reasoning and effort without warning (B1 fix)', () => {
    const settingsPath = join(testHome, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ reasoning: 'high', effort: 'medium' }), 'utf-8')
    const warnings: string[] = []
    const loaded = loadSettings({ warn: (w) => warnings.push(w) })
    expect(loaded.reasoning).toBe('high')
    expect(warnings.length).toBe(0)
  })

  it('routes warnings through custom warn callback when present', () => {
    const settingsPath = join(testHome, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ invalidRandomKey: 123 }), 'utf-8')
    const warnings: string[] = []
    loadSettings({ warn: (w) => warnings.push(w) })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('invalidRandomKey')
  })

  it('correctly sets, gets, and unsets allow.mcp and deny.mcp in KEYS table', () => {
    const s: Settings = {}
    KEYS['allow.mcp']!.set(s, ['git/*', 'db/query'])
    expect(s.allow?.mcp).toEqual(['git/*', 'db/query'])
    expect(KEYS['allow.mcp']!.get(s)).toEqual(['git/*', 'db/query'])

    KEYS['allow.mcp']!.unset(s)
    expect(s.allow?.mcp).toBeUndefined()

    KEYS['deny.mcp']!.set(s, ['git/delete_repo'])
    expect(s.deny?.mcp).toEqual(['git/delete_repo'])
    expect(KEYS['deny.mcp']!.get(s)).toEqual(['git/delete_repo'])

    KEYS['deny.mcp']!.unset(s)
    expect(s.deny?.mcp).toBeUndefined()

    // Test parser for comma-separated and JSON string
    expect(KEYS['allow.mcp']!.parse('server/a, server/b')).toEqual(['server/a', 'server/b'])
    expect(KEYS['deny.mcp']!.parse('["server/x", "server/y"]')).toEqual(['server/x', 'server/y'])
  })
})
