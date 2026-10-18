import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { resolveWithinRoot } from '../src/policy/paths.ts'
import { isPrivateAddress, validatePublicHost } from '../src/policy/net.ts'
import {
  matchToolRule,
  parseToolRule,
  primaryArg,
  resolveEffectivePermissions,
} from '../src/policy/toolPermissions.ts'

describe('policy subsystem', () => {
  describe('workspace path containment (resolveWithinRoot)', () => {
    const root = '/workspace/project'

    it('resolves relative and dot-slash paths safely within root', () => {
      expect(resolveWithinRoot('src/index.ts', root)).toBe(join(root, 'src/index.ts'))
      expect(resolveWithinRoot('./src/index.ts', root)).toBe(join(root, 'src/index.ts'))
      expect(resolveWithinRoot('.', root)).toBe(root)
    })

    it('rejects directory traversal attempts with ../', () => {
      expect(() => resolveWithinRoot('../outside.txt', root)).toThrow(/outside workspace root/)
      expect(() => resolveWithinRoot('src/../../outside.txt', root)).toThrow(
        /outside workspace root/,
      )
    })

    it('rejects absolute paths outside root', () => {
      expect(() => resolveWithinRoot('/etc/passwd', root)).toThrow(/outside workspace root/)
    })
  })

  describe('tool rules parsing and matching', () => {
    it('parses bare and scoped tool rules', () => {
      const bare = parseToolRule('ReadFile')
      expect(bare.tool).toBe('ReadFile')
      expect(bare.pattern).toBeNull()

      const scopedBash = parseToolRule('Bash(git *)')
      expect(scopedBash.tool).toBe('Bash')
      expect(scopedBash.pattern).toBe('git *')

      const scopedFile = parseToolRule('EditFile(src/*.ts)')
      expect(scopedFile.tool).toBe('EditFile')
      expect(scopedFile.pattern).toBe('src/*.ts')

      expect(() => parseToolRule('')).toThrow(/Malformed rule/)
    })

    it('matches prefix command patterns with token boundary and blocks chaining on allow rules', () => {
      const rule = parseToolRule('Bash(pytest *)')
      expect(matchToolRule(rule, 'Bash', 'pytest tests/')).toBe(true)
      expect(matchToolRule(rule, 'Bash', 'pytest')).toBe(true)
      expect(matchToolRule(rule, 'Bash', 'pytest-mock')).toBe(false)

      // Chained command injection attempts must be rejected by scoped allow rules
      expect(matchToolRule(rule, 'Bash', 'pytest && rm -rf /')).toBe(false)
      expect(matchToolRule(rule, 'Bash', 'pytest ; whoami')).toBe(false)
      expect(matchToolRule(rule, 'Bash', 'pytest | cat')).toBe(false)
    })

    it('matches compound command segments on deny rules', () => {
      const denyRule = parseToolRule('Bash(rm *)')
      expect(matchToolRule(denyRule, 'Bash', 'rm -rf /', true)).toBe(true)
      expect(matchToolRule(denyRule, 'Bash', 'git status && rm file.txt', true)).toBe(true)
      expect(matchToolRule(denyRule, 'Bash', 'echo hello; rm -rf target', true)).toBe(true)
    })

    it('matches glob patterns on file paths and host globs for WebFetch', () => {
      const singleGlob = parseToolRule('EditFile(src/*.ts)')
      expect(matchToolRule(singleGlob, 'EditFile', 'src/app.ts')).toBe(true)
      expect(matchToolRule(singleGlob, 'EditFile', 'src/sub/app.ts')).toBe(false)

      const recGlob = parseToolRule('EditFile(src/**/*.ts)')
      expect(matchToolRule(recGlob, 'EditFile', 'src/sub/app.ts')).toBe(true)

      const fetchRule = parseToolRule('WebFetch(*.github.com)')
      expect(matchToolRule(fetchRule, 'WebFetch', 'api.github.com')).toBe(true)
      expect(matchToolRule(fetchRule, 'WebFetch', 'evil.com')).toBe(false)
    })

    it('normalizes primary arguments accurately', () => {
      expect(primaryArg('ReadFile', { path: './src/index.ts' }, '/workspace')).toBe('src/index.ts')
      expect(primaryArg('WebFetch', { url: 'https://docs.anthropic.com/api' })).toBe(
        'docs.anthropic.com',
      )
      expect(
        primaryArg('McpTool', { action: 'call', server: 'github', tool: 'create_issue' }),
      ).toBe('github/create_issue')
    })
  })

  describe('effective permissions and mode invariants', () => {
    it('default mode: auto-approves read/search tools, denies writes and bash without rules', () => {
      const perms = resolveEffectivePermissions({
        mode: 'default',
        allowedRules: [],
        disallowedRules: [],
      })
      expect(perms.check('ReadFile', 'src/a.ts').allowed).toBe(true)
      expect(perms.check('ListDir', 'src').allowed).toBe(true)
      expect(perms.check('Grep', 'src').allowed).toBe(true)
      expect(perms.check('TaskManager', 'list').allowed).toBe(true)
      expect(perms.check('WriteFile', 'src/a.ts').allowed).toBe(false)
      expect(perms.check('Bash', 'ls -la').allowed).toBe(false)
    })

    it('explicit allowed-tools rules approve execution', () => {
      const perms = resolveEffectivePermissions({
        mode: 'default',
        allowedRules: [parseToolRule('Bash(git *)'), parseToolRule('WriteFile')],
        disallowedRules: [],
      })
      expect(perms.check('Bash', 'git status').allowed).toBe(true)
      expect(perms.check('Bash', 'curl evil.com').allowed).toBe(false)
      expect(perms.check('WriteFile', 'src/a.ts').allowed).toBe(true)
    })

    it('disallowed-tools always override allowed-tools (explicit deny wins)', () => {
      const perms = resolveEffectivePermissions({
        mode: 'default',
        allowedRules: [parseToolRule('Bash')],
        disallowedRules: [parseToolRule('Bash(rm *)')],
      })
      expect(perms.check('Bash', 'git status').allowed).toBe(true)
      const denyCheck = perms.check('Bash', 'rm -rf /')
      expect(denyCheck.allowed).toBe(false)
      expect(denyCheck.reason).toContain('Explicitly disallowed')
    })

    it('plan mode: restricts exposed tools to read-only tools', () => {
      const perms = resolveEffectivePermissions({
        mode: 'plan',
        allowedRules: [],
        disallowedRules: [],
      })
      expect(perms.exposedTools).toContain('ReadFile')
      expect(perms.exposedTools).toContain('ListDir')
      expect(perms.exposedTools).not.toContain('WriteFile')
      expect(perms.exposedTools).not.toContain('EditFile')
      expect(perms.exposedTools).not.toContain('Bash')
    })

    it('acceptEdits mode: auto-approves workspace file writes without rules, requires Bash rules', () => {
      const perms = resolveEffectivePermissions({
        mode: 'acceptEdits',
        allowedRules: [],
        disallowedRules: [],
      })
      expect(perms.check('WriteFile', 'src/app.ts').allowed).toBe(true)
      expect(perms.check('EditFile', 'src/app.ts').allowed).toBe(true)
      expect(perms.check('DeleteFile', 'src/app.ts').allowed).toBe(true)
      expect(perms.check('Bash', 'npm test').allowed).toBe(false)
    })

    it('bypassPermissions mode: auto-approves exposed tools unless explicitly denied', () => {
      const perms = resolveEffectivePermissions({
        mode: 'bypassPermissions',
        allowedRules: [],
        disallowedRules: [parseToolRule('Bash(rm *)')],
      })
      expect(perms.check('Bash', 'npm test').allowed).toBe(true)
      expect(perms.check('Bash', 'rm file.txt').allowed).toBe(false)
    })

    it('fails closed when exposedToolsFilter is explicitly empty', () => {
      const perms = resolveEffectivePermissions({
        mode: 'default',
        allowedRules: [],
        disallowedRules: [],
        exposedToolsFilter: [],
      })
      expect(perms.exposedTools).toEqual([])
    })
  })

  describe('network security and SSRF protection (validatePublicHost)', () => {
    it('identifies private, loopback, and special IP ranges accurately', () => {
      expect(isPrivateAddress('127.0.0.1')).toBe(true)
      expect(isPrivateAddress('10.0.0.1')).toBe(true)
      expect(isPrivateAddress('172.16.0.1')).toBe(true)
      expect(isPrivateAddress('192.168.1.1')).toBe(true)
      expect(isPrivateAddress('169.254.169.254')).toBe(true)
      expect(isPrivateAddress('::1')).toBe(true)
      expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
      expect(isPrivateAddress('fe80::1')).toBe(true)
      expect(isPrivateAddress('fc00::1')).toBe(true)
      expect(isPrivateAddress('93.184.216.34')).toBe(false)
      expect(isPrivateAddress('1.1.1.1')).toBe(false)
      expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
    })

    it('rejects localhost, private IPs, and brackets immediately', async () => {
      await expect(validatePublicHost('localhost')).rejects.toThrow(/prohibited/)
      await expect(validatePublicHost('127.0.0.1')).rejects.toThrow(/prohibited/)
      await expect(validatePublicHost('[::1]')).rejects.toThrow(/prohibited/)
      await expect(validatePublicHost('192.168.1.10')).rejects.toThrow(/prohibited/)
      await expect(validatePublicHost('10.254.0.1')).rejects.toThrow(/prohibited/)
    })

    it('rejects domains that resolve to private addresses using injected lookup', async () => {
      const fakeLookup = async () => [{ address: '127.0.0.1', family: 4 }]
      await expect(validatePublicHost('evil.attacker.com', fakeLookup)).rejects.toThrow(
        /prohibited/,
      )
    })

    it('rejects domains if ANY resolved address is private', async () => {
      const mixedLookup = async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]
      await expect(validatePublicHost('mixed.example.com', mixedLookup)).rejects.toThrow(
        /prohibited/,
      )
    })

    it('returns validated public addresses on successful resolution', async () => {
      const publicLookup = async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '93.184.216.35', family: 4 },
      ]
      const addrs = await validatePublicHost('example.com', publicLookup)
      expect(addrs).toEqual(['93.184.216.34', '93.184.216.35'])
    })
  })
})
