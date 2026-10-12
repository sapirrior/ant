import type { Capability, Grants } from '../types/config.ts'

export interface AuthorizationDecision {
  readonly allowed: boolean
  readonly reason?: string
}

export function authorize(requiredCap: Capability | undefined, grants: Grants): AuthorizationDecision {
  if (requiredCap === undefined) {
    return { allowed: true }
  }

  if (grants.has(requiredCap)) {
    return { allowed: true }
  }

  return {
    allowed: false,
    reason: `Operation requires capability "${requiredCap}", but it was not granted. Pass the appropriate --allow-* flag.`,
  }
}
