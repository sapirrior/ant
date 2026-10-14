export type McpToolVerdict =
  | { status: 'allowed' }
  | { status: 'denied'; reason: string }
  | { status: 'ask'; reason: string }

function globToRegex(pattern: string): RegExp {
  let pat = pattern.trim()
  if (!pat.includes('/') && pat !== '*') {
    pat = `${pat}/*`
  }
  const escaped = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

export function checkMcpToolPolicy(
  server: string,
  tool: string,
  allowedPatterns: readonly string[] = [],
  deniedPatterns: readonly string[] = []
): McpToolVerdict {
  const fullTarget = `${server}/${tool}`

  const matches = (pattern: string): boolean => {
    const trimmed = pattern.trim()
    if (!trimmed) return false
    try {
      return globToRegex(trimmed).test(fullTarget)
    } catch {
      return false
    }
  }

  // 1. Explicit denial takes immediate precedence without asking
  for (const pattern of deniedPatterns) {
    if (matches(pattern)) {
      return {
        status: 'denied',
        reason: `MCP tool "${fullTarget}" is explicitly denied by policy (--deny-mcp / deny.mcp)`,
      }
    }
  }

  // 2. Pre-allowed
  for (const pattern of allowedPatterns) {
    if (matches(pattern)) {
      return { status: 'allowed' }
    }
  }

  // 3. Not pre-allowed -> must ask for confirmation
  return {
    status: 'ask',
    reason: `MCP tool "${fullTarget}" requires user authorization`,
  }
}

export function isMcpToolAllowed(
  server: string,
  tool: string,
  allowedPatterns: readonly string[] = [],
  deniedPatterns: readonly string[] = []
): boolean {
  const verdict = checkMcpToolPolicy(server, tool, allowedPatterns, deniedPatterns)
  return verdict.status === 'allowed'
}
