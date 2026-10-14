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
  '.pypirc',
  '.pgpass',
  'credentials',
])

const SENSITIVE_PATTERNS = [
  /^\.env(\.[^.]+)?$/i,
  /\.(pem|key|pkcs12|pfx|p12|keystore)$/i,
  /credentials\.json$/i,
  /service-account.*\.json$/i,
  /secrets?\.(ya?ml|json|env)$/i,
]

/**
 * Checks if a file path (or base name) corresponds to a known sensitive/secret file.
 */
export function isSensitivePath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/')
  const name = basename(norm)

  // Benign template/example files are not sensitive
  if (/\.(example|sample|template|dist)$/i.test(name)) {
    return false
  }

  if (
    norm.endsWith('/.kube/config') ||
    norm.endsWith('/.docker/config.json') ||
    norm.endsWith('/.ssh/config') ||
    norm === '.kube/config' ||
    norm === '.docker/config.json' ||
    norm === '.ssh/config'
  ) {
    return true
  }

  if (EXACT_SENSITIVE_FILES.has(name)) {
    return true
  }

  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name))
}
