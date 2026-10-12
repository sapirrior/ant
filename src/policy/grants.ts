import type { Capability, Grants } from '../types/config.ts'

export interface GrantOptions {
  readonly allowRead?: boolean
  readonly allowEdit?: boolean
  readonly allowBash?: boolean
  readonly allowDestructiveBash?: boolean
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

  const immutableCaps: ReadonlySet<Capability> = Object.freeze(new Set(caps))

  return {
    has: (cap: Capability) => immutableCaps.has(cap),
    capabilities: immutableCaps,
  }
}
