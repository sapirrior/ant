import type { AbortReason } from './signals.ts'

export const SHUTDOWN_GRACE_MS = 8000

export type CleanupCallback = () => void | Promise<void>
export type SyncCleanupCallback = () => void

export interface Lifecycle {
  readonly controller: AbortController
  readonly signal: AbortSignal
  onCleanup(fn: CleanupCallback): () => void
  onEmergencyCleanup(fn: SyncCleanupCallback): () => void
  dispose(): void
}

export function createLifecycle(options?: {
  graceMs?: number
  onSignal?: (reason: AbortReason) => void
  onError?: (err: unknown) => void
}): Lifecycle {
  const controller = new AbortController()
  const graceMs = options?.graceMs ?? SHUTDOWN_GRACE_MS

  const cleanups: CleanupCallback[] = []
  const emergencyCleanups: SyncCleanupCallback[] = []

  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let isDisposed = false
  let isEmergencyExiting = false

  const runEmergencyCleanup = () => {
    if (isEmergencyExiting) return
    isEmergencyExiting = true

    for (const fn of emergencyCleanups.slice().reverse()) {
      try {
        fn()
      } catch {
        // Suppress errors during emergency exit
      }
    }
  }

  const handleSignal = (reason: AbortReason, exitCode: number) => {
    if (isDisposed) return

    if (!controller.signal.aborted) {
      options?.onSignal?.(reason)
      controller.abort(reason)

      // Start grace timer for shutdown
      graceTimer = setTimeout(() => {
        runEmergencyCleanup()
        process.exit(exitCode)
      }, graceMs)
      graceTimer.unref()
    } else {
      // Second signal: immediate forced exit
      if (graceTimer) clearTimeout(graceTimer)
      runEmergencyCleanup()
      process.exit(exitCode)
    }
  }

  const onSigint = () => handleSignal('SIGINT', 130)
  const onSigterm = () => handleSignal('SIGTERM', 143)
  const onSighup = () => handleSignal('SIGHUP', 129)

  const onUncaughtException = (err: unknown) => {
    if (isDisposed) return
    options?.onError?.(err)
    process.stderr.write(`[ant] uncaught exception: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    runEmergencyCleanup()
    process.exit(5)
  }

  const onUnhandledRejection = (reason: unknown) => {
    if (isDisposed) return
    options?.onError?.(reason)
    process.stderr.write(`[ant] unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}\n`)
    runEmergencyCleanup()
    process.exit(5)
  }

  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  process.on('SIGHUP', onSighup)
  process.on('uncaughtException', onUncaughtException)
  process.on('unhandledRejection', onUnhandledRejection)

  const dispose = () => {
    if (isDisposed) return
    isDisposed = true

    if (graceTimer) {
      clearTimeout(graceTimer)
      graceTimer = undefined
    }

    for (const fn of cleanups.slice().reverse()) {
      try {
        const res = fn()
        if (res && typeof (res as any).catch === 'function') {
          ;(res as Promise<void>).catch(() => {})
        }
      } catch {
        // Suppress errors during cleanup
      }
    }

    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    process.off('SIGHUP', onSighup)
    process.off('uncaughtException', onUncaughtException)
    process.off('unhandledRejection', onUnhandledRejection)
  }

  return {
    controller,
    signal: controller.signal,
    onCleanup(fn: CleanupCallback) {
      cleanups.push(fn)
      return () => {
        const idx = cleanups.indexOf(fn)
        if (idx >= 0) cleanups.splice(idx, 1)
      }
    },
    onEmergencyCleanup(fn: SyncCleanupCallback) {
      emergencyCleanups.push(fn)
      return () => {
        const idx = emergencyCleanups.indexOf(fn)
        if (idx >= 0) emergencyCleanups.splice(idx, 1)
      }
    },
    dispose,
  }
}
