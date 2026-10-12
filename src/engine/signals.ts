export function setupSignalHandler(): {
  readonly controller: AbortController
  readonly cleanup: () => void
} {
  const controller = new AbortController()

  const handleSignal = () => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  }

  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)

  const cleanup = () => {
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
  }

  return {
    controller,
    cleanup,
  }
}
