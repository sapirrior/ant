export type ShellCommandCategory = 'safe' | 'destructive'

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*|-r|--recursive)/i,
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*|-f|--force)/i,
  /\brmdir\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /\bchmod\s+(-R|--recursive)\b/i,
  /\bchown\s+(-R|--recursive)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-zA-Z]*f/i,
  /\b(shutdown|reboot|poweroff|halt)\b/i,
]

export function classifyCommand(command: string): ShellCommandCategory {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return 'destructive'
    }
  }
  return 'safe'
}
