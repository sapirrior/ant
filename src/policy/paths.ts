import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Resolves a given target path within the specified root directory.
 * Prevents directory traversal attacks (e.g. "../../../etc/passwd") and symlink escapes.
 * Throws an error if the resolved path escapes the root directory.
 */
export function resolveWithinRoot(targetPath: string, rootDir: string): string {
  const resolvedRoot = existsSync(rootDir) ? realpathSync(resolve(rootDir)) : resolve(rootDir)
  const resolvedTarget = isAbsolute(targetPath) ? resolve(targetPath) : resolve(resolvedRoot, targetPath)

  const rel = relative(resolvedRoot, resolvedTarget)

  // If relative path is '..' or starts with '../', or is an absolute drive jump, it escaped root
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Access denied: path "${targetPath}" resolves to "${resolvedTarget}", which is outside workspace root "${resolvedRoot}".`)
  }

  // Check realpath if the file/target or its ancestor exists to prevent symlink traversal escapes
  if (existsSync(resolvedTarget)) {
    const realTarget = realpathSync(resolvedTarget)
    const relReal = relative(resolvedRoot, realTarget)
    if (relReal === '..' || relReal.startsWith(`..${sep}`) || isAbsolute(relReal)) {
      throw new Error(`Access denied: symlink "${targetPath}" resolves to "${realTarget}", which is outside workspace root "${resolvedRoot}".`)
    }
    return realTarget
  }

  return resolvedTarget
}
