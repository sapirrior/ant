import type { ToolName } from '../core/types.ts'

export type PermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'dontAsk'
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

export function matchToolRule(
  rule: ParsedToolRule,
  toolName: ToolName,
  primaryArg: string
): boolean {
  if (rule.tool !== toolName) {
    return false
  }

  if (rule.pattern === null || rule.pattern === '*') {
    return true
  }

  const pattern = rule.pattern

  // Prefix pattern matching (e.g. "git diff *")
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1).trimEnd()
    if (primaryArg === prefix || primaryArg.startsWith(prefix + ' ') || primaryArg.startsWith(prefix)) {
      return true
    }
  }

  // Glob matching for file paths (simple wildcard match)
  if (pattern.includes('*')) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
    const regex = new RegExp(`^${escaped}$`)
    return regex.test(primaryArg)
  }

  return primaryArg === pattern
}

export interface PermissionCheckResult {
  readonly allowed: boolean
  readonly reason?: string
}

export interface EffectivePermissions {
  readonly mode: PermissionMode
  readonly exposedTools: readonly ToolName[]
  check(tool: ToolName, primaryArg?: string): PermissionCheckResult
}

export interface ResolveEffectivePermissionsOptions {
  readonly mode: PermissionMode
  readonly allowedRules: readonly ParsedToolRule[]
  readonly disallowedRules: readonly ParsedToolRule[]
  readonly exposedToolsFilter?: readonly ToolName[]
}

export function resolveEffectivePermissions(
  options: ResolveEffectivePermissionsOptions
): EffectivePermissions {
  const { mode, allowedRules, disallowedRules, exposedToolsFilter } = options

  // 1. Determine exposed tools based on mode & filter
  let baseExposed: ToolName[]
  if (mode === 'plan') {
    // Hide all mutating tools in plan mode
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
    check(tool: ToolName, primaryArg: string = ''): PermissionCheckResult {
      // 1. Explicit deny rules always win
      for (const deny of disallowedRules) {
        if (matchToolRule(deny, tool, primaryArg)) {
          return {
            allowed: false,
            reason: `Explicitly disallowed by rule "${deny.raw}"`,
          }
        }
      }

      // 2. Mode-specific auto-approvals
      if (mode === 'bypassPermissions') {
        return { allowed: true }
      }

      if (mode === 'acceptEdits' && WRITE_TOOLS.has(tool)) {
        return { allowed: true }
      }

      if ((mode === 'default' || mode === 'acceptEdits' || mode === 'plan') && READ_ONLY_TOOLS.has(tool)) {
        return { allowed: true }
      }

      // 3. Explicit allow rules
      for (const allow of allowedRules) {
        if (matchToolRule(allow, tool, primaryArg)) {
          return { allowed: true }
        }
      }

      // 4. Default deny
      return {
        allowed: false,
        reason: `Tool "${tool}" is not permitted under mode "${mode}". Re-run with --allowed-tools "${tool}" or appropriate --permission-mode.`,
      }
    },
  }
}
