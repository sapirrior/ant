export type McpToolVerdict =
  | { status: 'allowed' }
  | { status: 'denied'; reason: string }
  | { status: 'ask'; reason: string }

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
    if (trimmed === '*' || trimmed === '*/*') return true
    if (trimmed.endsWith('/*')) {
      const prefix = trimmed.slice(0, -2)
      return prefix === server
    }
    return trimmed === fullTarget
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
