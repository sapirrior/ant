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

  // Check realpath if target exists or if an existing ancestor is inside an existing root
  if (existsSync(resolvedRoot)) {
    let current = resolvedTarget
    while (!existsSync(current)) {
      const parent = resolve(current, '..')
      if (parent === current) break
      current = parent
    }

    if (existsSync(current)) {
      const realAncestor = realpathSync(current)
      const relReal = relative(resolvedRoot, realAncestor)
      if (relReal === '..' || relReal.startsWith(`..${sep}`) || isAbsolute(relReal)) {
        throw new Error(`Access denied: path "${targetPath}" traverses symlink escaping workspace root "${resolvedRoot}".`)
      }
    }
  }

  if (existsSync(resolvedTarget)) {
    return realpathSync(resolvedTarget)
  }

  return resolvedTarget
}
