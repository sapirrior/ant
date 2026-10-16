import { describe, expect, it } from 'bun:test'
import {
  parseToolRule,
  matchToolRule,
  resolveEffectivePermissions,
  primaryArg,
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

  it('matches prefix command patterns with token boundary (fixes #2)', () => {
    const rule = parseToolRule('Bash(git diff *)')
    expect(matchToolRule(rule, 'Bash', 'git diff HEAD')).toBe(true)
    expect(matchToolRule(rule, 'Bash', 'git diff --stat')).toBe(true)
    expect(matchToolRule(rule, 'Bash', 'git diff')).toBe(true)
    // Does NOT match commands without token boundary
    expect(matchToolRule(rule, 'Bash', 'git differential')).toBe(false)
    expect(matchToolRule(rule, 'Bash', 'git difference')).toBe(false)
  })

  it('rejects compound/chained commands on scoped allow rules (fixes N2)', () => {
    const rule = parseToolRule('Bash(git diff *)')
    expect(matchToolRule(rule, 'Bash', 'git diff; rm x', false)).toBe(false)
    expect(matchToolRule(rule, 'Bash', 'git diff && rm x', false)).toBe(false)
    expect(matchToolRule(rule, 'Bash', 'git diff | sh', false)).toBe(false)
    expect(matchToolRule(rule, 'Bash', 'git diff $(rm x)', false)).toBe(false)
    expect(matchToolRule(rule, 'Bash', 'git diff `rm x`', false)).toBe(false)
  })

  it('matches compound/chained command segments on deny rules (fixes N2)', () => {
    const denyRule = parseToolRule('Bash(rm *)')
    expect(matchToolRule(denyRule, 'Bash', 'git diff; rm x', true)).toBe(true)
    expect(matchToolRule(denyRule, 'Bash', 'git status && rm file.txt', true)).toBe(true)
    expect(matchToolRule(denyRule, 'Bash', 'echo $(rm -rf /)', true)).toBe(true)
  })

  it('matches glob patterns on file paths', () => {
    const rule = parseToolRule('ReadFile(src/*.ts)')
    expect(matchToolRule(rule, 'ReadFile', 'src/main.ts')).toBe(true)
    expect(matchToolRule(rule, 'ReadFile', 'README.md')).toBe(false)
  })

  it('matches host globs for WebFetch', () => {
    const rule = parseToolRule('WebFetch(*.github.com)')
    expect(matchToolRule(rule, 'WebFetch', 'api.github.com')).toBe(true)
    expect(matchToolRule(rule, 'WebFetch', 'raw.github.com')).toBe(true)
    expect(matchToolRule(rule, 'WebFetch', 'google.com')).toBe(false)
  })
})

describe('primaryArg resolution (fixes N1, N6)', () => {
  const cwd = '/workspace/project'

  it('normalizes file paths to cwd-relative POSIX format', () => {
    expect(primaryArg('WriteFile', { path: './.env' }, cwd)).toBe('.env')
    expect(primaryArg('WriteFile', { path: 'src/../.env' }, cwd)).toBe('.env')
    expect(primaryArg('WriteFile', { path: '/workspace/project/.env' }, cwd)).toBe('.env')
    expect(primaryArg('WriteFile', { path: 'src/main.ts' }, cwd)).toBe('src/main.ts')
  })

  it('resolves WebFetch host correctly', () => {
    expect(primaryArg('WebFetch', { url: 'https://api.github.com/v1/repos' }, cwd)).toBe(
      'api.github.com',
    )
  })

  it('resolves McpTool action/tool format correctly', () => {
    expect(primaryArg('McpTool', { action: 'call', server: 'github', tool: 'get_repo' }, cwd)).toBe(
      'github/get_repo',
    )
    expect(primaryArg('McpTool', { action: 'list_tools', server: 'github' }, cwd)).toBe(
      'github/list_tools',
    )
  })
})

describe('resolveEffectivePermissions', () => {
  it('default mode: auto-approves read/search tools, TaskManager, denies WriteFile and Bash without rules', () => {
    const perms = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [],
      disallowedRules: [],
    })
    expect(perms.check('ReadFile', 'package.json').allowed).toBe(true)
    expect(perms.check('ListDir', '.').allowed).toBe(true)
    expect(perms.check('Grep', 'test').allowed).toBe(true)
    expect(perms.check('WebSearch', 'query').allowed).toBe(true)
    expect(perms.check('TaskManager').allowed).toBe(true)
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

  it('differentiates toolname(*) single-directory glob from toolname(**) recursive glob', () => {
    const rootOnly = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [parseToolRule('WriteFile(*)')],
      disallowedRules: [],
    })
    expect(rootOnly.check('WriteFile', 'package.json').allowed).toBe(true)
    expect(rootOnly.check('WriteFile', 'src/main.ts').allowed).toBe(false)

    const recursive = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [parseToolRule('WriteFile(**)')],
      disallowedRules: [],
    })
    expect(recursive.check('WriteFile', 'package.json').allowed).toBe(true)
    expect(recursive.check('WriteFile', 'src/main.ts').allowed).toBe(true)
  })

  it('enforces chaining protection even for broad Bash(*) scoped allow rules', () => {
    const bashWildcard = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [parseToolRule('Bash(*)')],
      disallowedRules: [],
    })
    expect(bashWildcard.check('Bash', 'git status').allowed).toBe(true)
    expect(bashWildcard.check('Bash', 'ls -la').allowed).toBe(true)
    expect(bashWildcard.check('Bash', 'git status; rm -rf /').allowed).toBe(false)
    expect(bashWildcard.check('Bash', 'cat file | sh').allowed).toBe(false)
    expect(bashWildcard.check('Bash', 'echo $(whoami)').allowed).toBe(false)
  })

  it('fails closed when exposedToolsFilter is explicitly empty', () => {
    const emptyFilter = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [],
      disallowedRules: [],
      exposedToolsFilter: [],
    })
    expect(emptyFilter.exposedTools).toEqual([])
  })
})
