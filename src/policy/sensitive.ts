import { basename } from 'node:path'

/**
 * Patterns and exact names of sensitive files that should not be read or searched
 * without explicit user grants or permissions.
 */
const EXACT_SENSITIVE_FILES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.env.staging',
  '.env.test',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pgpass',
  'credentials',
])

const SENSITIVE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|pkcs12|pfx|keystore)$/i,
  /credentials\.json$/i,
  /secrets?\.(ya?ml|json|env)$/i,
]

/**
 * Checks if a file path (or base name) corresponds to a known sensitive/secret file.
 */
export function isSensitivePath(filePath: string): boolean {
  const name = basename(filePath)
  if (EXACT_SENSITIVE_FILES.has(name)) {
    return true
  }
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name))
}
