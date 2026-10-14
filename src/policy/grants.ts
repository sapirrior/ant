import type { Capability, Grants } from '../core/types.ts'

export interface GrantOptions {
  readonly allowRead?: boolean
  readonly allowEdit?: boolean
  readonly allowBash?: boolean
  readonly allowDestructiveBash?: boolean
  readonly allowSensitive?: boolean
}

export function resolveGrants(options: GrantOptions): Grants {
  const caps = new Set<Capability>()

  if (options.allowRead || options.allowEdit) {
    caps.add('fs.read')
  }

  if (options.allowEdit) {
    caps.add('fs.write')
  }

  if (options.allowBash || options.allowDestructiveBash) {
    caps.add('shell.run')
  }

  if (options.allowDestructiveBash) {
    caps.add('shell.destructive')
  }

  if (options.allowSensitive || options.allowDestructiveBash) {
    caps.add('fs.sensitive')
  }

  const frozenSet = new Set(caps)
  frozenSet.add = () => {
    throw new Error('Cannot mutate read-only grants set')
  }
  frozenSet.delete = () => {
    throw new Error('Cannot mutate read-only grants set')
  }
  frozenSet.clear = () => {
    throw new Error('Cannot mutate read-only grants set')
  }

  return {
    has: (cap: Capability) => caps.has(cap),
    capabilities: frozenSet as ReadonlySet<Capability>,
  }
}
