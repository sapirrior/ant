import type { Capability, Grants } from '../types/config.ts'
import type { ParsedCliArgs } from './argv.ts'

export function resolveGrants(args: Pick<ParsedCliArgs, 'allowRead' | 'allowEdit' | 'allowBash' | 'allowDestructiveBash'>): Grants {
  const caps = new Set<Capability>()

  if (args.allowRead || args.allowEdit) {
    caps.add('fs.read')
  }

  if (args.allowEdit) {
    caps.add('fs.write')
  }

  if (args.allowBash || args.allowDestructiveBash) {
    caps.add('shell.run')
  }

  if (args.allowDestructiveBash) {
    caps.add('shell.destructive')
  }

  const immutableCaps: ReadonlySet<Capability> = Object.freeze(new Set(caps))

  return {
    has: (cap: Capability) => immutableCaps.has(cap),
    capabilities: immutableCaps,
  }
}
