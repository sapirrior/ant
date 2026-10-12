import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Resolves a given target path within the specified root directory.
 * Prevents directory traversal attacks (e.g. "../../../etc/passwd").
 * Throws an error if the resolved path escapes the root directory.
 */
export function resolveWithinRoot(targetPath: string, rootDir: string): string {
  const resolvedRoot = resolve(rootDir)
  const resolvedTarget = isAbsolute(targetPath) ? resolve(targetPath) : resolve(resolvedRoot, targetPath)

  const rel = relative(resolvedRoot, resolvedTarget)

  // If relative path starts with '..' or is an absolute drive jump, it escaped root
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Access denied: path "${targetPath}" resolves to "${resolvedTarget}", which is outside workspace root "${resolvedRoot}".`)
  }

  return resolvedTarget
}
