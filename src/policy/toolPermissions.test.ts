import { describe, expect, it } from 'bun:test'
import {
  parseToolRule,
  matchToolRule,
  resolveEffectivePermissions,
} from './toolPermissions.ts'

describe('parseToolRule', () => {
  it('parses bare tool names into wildcard rules', () => {
    const rule = parseToolRule('Bash')
    expect(rule.tool).toBe('Bash')
    expect(rule.pattern).toBeNull()

    const readRule = parseToolRule('ReadFile')
    expect(readRule.tool).toBe('ReadFile')
    expect(readRule.pattern).toBeNull()
  })

  it('parses scoped Bash rules with command patterns', () => {
    const rule = parseToolRule('Bash(git diff *)')
    expect(rule.tool).toBe('Bash')
    expect(rule.pattern).toBe('git diff *')
  })

  it('parses scoped file rules with path patterns', () => {
    const rule = parseToolRule('ReadFile(src/*.ts)')
    expect(rule.tool).toBe('ReadFile')
    expect(rule.pattern).toBe('src/*.ts')
  })

  it('throws a syntax error on malformed rules', () => {
    expect(() => parseToolRule('Bash(git diff')).toThrow(/Malformed rule/)
    expect(() => parseToolRule('Bash)')).toThrow(/Malformed rule/)
    expect(() => parseToolRule('()')).toThrow(/Malformed rule/)
    expect(() => parseToolRule('UnknownTool(test)')).toThrow(/Unknown tool/)
  })
})

describe('matchToolRule', () => {
  it('matches bare rules against any call of that tool', () => {
    const rule = parseToolRule('Bash')
    expect(matchToolRule(rule, 'Bash', 'rm -rf /')).toBe(true)
    expect(matchToolRule(rule, 'ReadFile', 'package.json')).toBe(false)
  })

  it('matches prefix command patterns on Bash commands', () => {
    const rule = parseToolRule('Bash(git diff *)')
    expect(matchToolRule(rule, 'Bash', 'git diff HEAD')).toBe(true)
    expect(matchToolRule(rule, 'Bash', 'git commit -m "msg"')).toBe(false)
  })

  it('matches glob patterns on file paths', () => {
    const rule = parseToolRule('ReadFile(src/*.ts)')
    expect(matchToolRule(rule, 'ReadFile', 'src/main.ts')).toBe(true)
    expect(matchToolRule(rule, 'ReadFile', 'README.md')).toBe(false)
  })
})

describe('resolveEffectivePermissions', () => {
  it('default mode: auto-approves read/search tools, denies WriteFile and Bash without rules', () => {
    const perms = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [],
      disallowedRules: [],
    })
    expect(perms.check('ReadFile', 'package.json').allowed).toBe(true)
    expect(perms.check('ListDir', '.').allowed).toBe(true)
    expect(perms.check('Grep', 'test').allowed).toBe(true)
    expect(perms.check('WebSearch', 'query').allowed).toBe(true)
    expect(perms.check('WriteFile', 'foo.txt').allowed).toBe(false)
    expect(perms.check('Bash', 'ls').allowed).toBe(false)
  })

  it('default mode: explicit allowed-tools approve writes or Bash', () => {
    const perms = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [parseToolRule('WriteFile'), parseToolRule('Bash(bun test *)')],
      disallowedRules: [],
    })
    expect(perms.check('WriteFile', 'foo.txt').allowed).toBe(true)
    expect(perms.check('Bash', 'bun test').allowed).toBe(true)
    expect(perms.check('Bash', 'rm -rf /').allowed).toBe(false)
  })

  it('disallowed-tools always override allowed-tools (deny wins)', () => {
    const perms = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [parseToolRule('WriteFile'), parseToolRule('Bash')],
      disallowedRules: [parseToolRule('Bash(rm *)'), parseToolRule('WriteFile(.env*)')],
    })
    expect(perms.check('Bash', 'git status').allowed).toBe(true)
    expect(perms.check('Bash', 'rm file.txt').allowed).toBe(false)
    expect(perms.check('WriteFile', 'src/main.ts').allowed).toBe(true)
    expect(perms.check('WriteFile', '.env.local').allowed).toBe(false)
  })

  it('plan mode: hides mutating tools from exposed tools', () => {
    const perms = resolveEffectivePermissions({
      mode: 'plan',
      allowedRules: [],
      disallowedRules: [],
    })
    expect(perms.exposedTools).toContain('ReadFile')
    expect(perms.exposedTools).toContain('ListDir')
    expect(perms.exposedTools).toContain('Grep')
    expect(perms.exposedTools).not.toContain('WriteFile')
    expect(perms.exposedTools).not.toContain('EditFile')
    expect(perms.exposedTools).not.toContain('DeleteFile')
    expect(perms.exposedTools).not.toContain('Bash')
  })

  it('acceptEdits mode: auto-approves workspace file writes without rules, requires Bash rules', () => {
    const perms = resolveEffectivePermissions({
      mode: 'acceptEdits',
      allowedRules: [],
      disallowedRules: [],
    })
    expect(perms.check('WriteFile', 'src/file.ts').allowed).toBe(true)
    expect(perms.check('EditFile', 'src/file.ts').allowed).toBe(true)
    expect(perms.check('DeleteFile', 'src/file.ts').allowed).toBe(true)
    expect(perms.check('Bash', 'ls').allowed).toBe(false)
  })

  it('bypassPermissions mode: auto-approves exposed tools unless denied explicitly', () => {
    const perms = resolveEffectivePermissions({
      mode: 'bypassPermissions',
      allowedRules: [],
      disallowedRules: [parseToolRule('Bash(rm *)')],
    })
    expect(perms.check('WriteFile', 'src/file.ts').allowed).toBe(true)
    expect(perms.check('Bash', 'git status').allowed).toBe(true)
    expect(perms.check('Bash', 'rm -rf /').allowed).toBe(false)
  })
})
