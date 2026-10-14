/**
 * Checks if a process with the given PID is alive.
 */
export function pidAlive(pid: number): boolean {
  if (pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'EPERM') {
      return true
    }
    return false
  }
}
