/**
 * Signals and abort reason helpers per Plan Phase 1 (B2 fix).
 *
 * Verification notes from Phase 0:
 * - Bun 1.4+: signal.reason is a read-only getter on EventTarget/AbortSignal.
 * - controller.abort(reason) correctly sets signal.reason to the passed value.
 */

export type AbortReason = 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'timeout'

export const KNOWN_ABORT_REASONS = new Set<string>(['SIGINT', 'SIGTERM', 'SIGHUP', 'timeout'])

export function abortReasonOf(signal: AbortSignal): AbortReason | undefined {
  if (!signal.aborted) {
    return undefined
  }
  const reason = (signal as any).reason
  if (typeof reason === 'string' && KNOWN_ABORT_REASONS.has(reason)) {
    return reason as AbortReason
  }
  return undefined
}
