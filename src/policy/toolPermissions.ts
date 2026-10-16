import { isAbsolute, normalize, resolve } from 'node:path'
import type { ToolName } from '../core/types.ts'

export type PermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'bypassPermissions'

export const KNOWN_TOOLS: readonly ToolName[] = [
  'ReadFile',
  'ListDir',
  'Grep',
  'WriteFile',
  'EditFile',
  'DeleteFile',
  'Bash',
  'TaskManager',
  'WebSearch',
  'WebFetch',
  'McpTool',
]

const READ_ONLY_TOOLS = new Set<ToolName>([
  'ReadFile',
  'ListDir',
  'Grep',
  'WebSearch',
  'WebFetch',
])

const WRITE_TOOLS = new Set<ToolName>([
  'WriteFile',
  'EditFile',
  'DeleteFile',
])

export interface ParsedToolRule {
  readonly raw: string
  readonly tool: ToolName
  readonly pattern: string | null
}

export function parseToolRule(ruleStr: string): ParsedToolRule {
  const trimmed = ruleStr.trim()
  if (!trimmed) {
    throw new Error('Malformed rule: empty string')
  }

  const parenIdx = trimmed.indexOf('(')
  if (parenIdx === 0) {
    throw new Error(`Malformed rule: "${trimmed}" (missing tool name before parenthesis)`)
  }
  if (parenIdx === -1) {
    if (trimmed.endsWith(')')) {
      throw new Error(`Malformed rule: "${trimmed}"`)
    }
    const tool = trimmed as ToolName
    if (!KNOWN_TOOLS.includes(tool)) {
      throw new Error(`Unknown tool "${tool}" in permission rule`)
    }
    return { raw: trimmed, tool, pattern: null }
  }

  if (!trimmed.endsWith(')')) {
    throw new Error(`Malformed rule: "${trimmed}" (missing closing parenthesis)`)
  }

  const tool = trimmed.slice(0, parenIdx).trim() as ToolName
  if (!KNOWN_TOOLS.includes(tool)) {
    throw new Error(`Unknown tool "${tool}" in permission rule`)
  }

  const pattern = trimmed.slice(parenIdx + 1, -1).trim()
  if (!pattern) {
    throw new Error(`Malformed rule: empty pattern inside parentheses in "${trimmed}"`)
  }

  return { raw: trimmed, tool, pattern }
}

export function normalizePathForPolicy(targetPath: string, cwd: string): string {
  const normCwd = normalize(cwd).replace(/\\/g, '/')
  const resolved = isAbsolute(targetPath)
    ? normalize(targetPath).replace(/\\/g, '/')
    : normalize(resolve(cwd, targetPath)).replace(/\\/g, '/')

  if (resolved === normCwd) {
    return '.'
  }
  if (resolved.startsWith(normCwd + '/')) {
    return resolved.slice(normCwd.length + 1)
  }
  return resolved
}

export function primaryArg(tool: ToolName | string, input: unknown, cwd: string = process.cwd()): string {
  if (typeof input !== 'object' || input === null) return ''
  const record = input as Record<string, unknown>

  switch (tool) {
    case 'Bash':
      return typeof record.command === 'string' ? record.command : ''
    case 'ReadFile':
    case 'ListDir':
    case 'WriteFile':
    case 'EditFile':
    case 'DeleteFile': {
      const p = typeof record.path === 'string' ? record.path : ''
      return p ? normalizePathForPolicy(p, cwd) : ''
    }
    case 'Grep': {
      const p = typeof record.path === 'string' && record.path.trim() ? record.path : '.'
      return normalizePathForPolicy(p, cwd)
    }
    case 'WebFetch': {
      if (typeof record.url === 'string') {
        try {
          const u = new URL(record.url)
          return u.hostname
        } catch {
          return ''
        }
      }
      return ''
    }
    case 'WebSearch':
      return ''
    case 'McpTool': {
      const action = typeof record.action === 'string' ? record.action : ''
      const server = typeof record.server === 'string' ? record.server : '*'
      const t = typeof record.tool === 'string' ? record.tool : ''
      if (action === 'call') {
        return `${server}/${t}`
      }
      if (action === 'list_tools') {
        return `${server}/list_tools`
      }
      if (action === 'list_servers') {
        return `${server}/list_servers`
      }
      return `${server}/${action || '*'}`
    }
    case 'TaskManager':
      return ''
    default:
      return ''
  }
}

const BASH_CHAINING_REGEX = /[;&|\n`]|(?:\$|<|>)\(/

function matchBashPrefix(pattern: string, cmd: string): boolean {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1).trimEnd()
    if (!prefix) {
      return true
    }
    return cmd === prefix || cmd.startsWith(prefix + ' ')
  }
  return cmd === pattern
}

function matchBashRule(pattern: string, command: string, isDeny: boolean): boolean {
  const trimmed = command.trim()
  if (isDeny) {
    if (matchBashPrefix(pattern, trimmed)) {
      return true
    }
    const segments = command
      .split(/[;&|\n`()]/)
      .map((s) => s.replace(/^\$\(/, '').trim())
      .filter(Boolean)
    for (const seg of segments) {
      if (matchBashPrefix(pattern, seg)) {
        return true
      }
    }
    return false
  }

  // Scoped allow rules: reject any chaining or command substitution
  if (BASH_CHAINING_REGEX.test(command)) {
    return false
  }

  return matchBashPrefix(pattern, trimmed)
}

function matchPathGlob(pattern: string, normPath: string): boolean {
  const cleanPattern = pattern.replace(/^\.\//, '')
  try {
    const glob = new Bun.Glob(cleanPattern)
    return glob.match(normPath)
  } catch {
    return normPath === cleanPattern
  }
}

function matchGlob(pattern: string, str: string): boolean {
  try {
    const glob = new Bun.Glob(pattern)
    return glob.match(str)
  } catch {
    return str === pattern
  }
}

export function matchToolRule(
  rule: ParsedToolRule,
  toolName: ToolName | string,
  primaryArgStr: string,
  isDeny: boolean = false
): boolean {
  if (rule.tool !== toolName) {
    return false
  }

  if (rule.pattern === null) {
    return true
  }

  if (toolName === 'Bash') {
    return matchBashRule(rule.pattern, primaryArgStr, isDeny)
  }

  if (toolName === 'WebFetch') {
    return matchGlob(rule.pattern, primaryArgStr)
  }

  if (
    toolName === 'ReadFile' ||
    toolName === 'ListDir' ||
    toolName === 'WriteFile' ||
    toolName === 'EditFile' ||
    toolName === 'DeleteFile' ||
    toolName === 'Grep'
  ) {
    return matchPathGlob(rule.pattern, primaryArgStr)
  }

  if (toolName === 'McpTool') {
    return matchGlob(rule.pattern, primaryArgStr)
  }

  return primaryArgStr === rule.pattern
}

export interface PermissionCheckResult {
  readonly allowed: boolean
  readonly reason?: string
  readonly isExplicitRule?: boolean
}

export interface EffectivePermissions {
  readonly mode: PermissionMode
  readonly exposedTools: readonly ToolName[]
  check(tool: ToolName | string, primaryArg?: string): PermissionCheckResult
}

export interface ResolveEffectivePermissionsOptions {
  readonly mode: PermissionMode
  readonly allowedRules: readonly ParsedToolRule[]
  readonly disallowedRules: readonly ParsedToolRule[]
  readonly exposedToolsFilter?: readonly ToolName[]
  readonly cwd?: string
}

export function resolveEffectivePermissions(
  options: ResolveEffectivePermissionsOptions
): EffectivePermissions {
  const { mode, allowedRules, disallowedRules, exposedToolsFilter } = options

  let baseExposed: ToolName[]
  if (mode === 'plan') {
    baseExposed = KNOWN_TOOLS.filter((t) => READ_ONLY_TOOLS.has(t))
  } else {
    baseExposed = [...KNOWN_TOOLS]
  }

  if (exposedToolsFilter && exposedToolsFilter.length > 0) {
    baseExposed = baseExposed.filter((t) => exposedToolsFilter.includes(t))
  }

  return {
    mode,
    exposedTools: baseExposed,
    check(tool: ToolName | string, primaryArgVal: string = ''): PermissionCheckResult {
      // 1. Explicit deny rules always win
      for (const deny of disallowedRules) {
        if (matchToolRule(deny, tool, primaryArgVal, true)) {
          return {
            allowed: false,
            reason: `Explicitly disallowed by rule "${deny.raw}"`,
          }
        }
      }

      // 2. Mode bypass
      if (mode === 'bypassPermissions') {
        return { allowed: true }
      }

      // 3. Explicit allow rules
      for (const allow of allowedRules) {
        if (matchToolRule(allow, tool, primaryArgVal, false)) {
          return { allowed: true, isExplicitRule: true }
        }
      }

      // 4. Mode defaults
      // TaskManager is always allowed (manages background processes started by ant)
      if (tool === 'TaskManager') {
        return { allowed: true }
      }

      // Read-only tools in default, acceptEdits, plan
      if ((mode === 'default' || mode === 'acceptEdits' || mode === 'plan') && READ_ONLY_TOOLS.has(tool as ToolName)) {
        return { allowed: true }
      }

      // acceptEdits allows workspace file write tools
      if (mode === 'acceptEdits' && WRITE_TOOLS.has(tool as ToolName)) {
        return { allowed: true }
      }

      // 5. Default deny
      const toolDescriptor = primaryArgVal ? `${tool}(${primaryArgVal})` : tool
      const allowSuggestion = primaryArgVal ? `${tool}(${primaryArgVal})` : tool
      return {
        allowed: false,
        reason: `${toolDescriptor} not allowed in mode ${mode}. Allow with --allowed-tools '${allowSuggestion}'.`,
      }
    },
  }
}
