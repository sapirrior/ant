import type { Database } from 'bun:sqlite'

export function writeTx<T>(db: Database, fn: () => T): T {
  let attempts = 0
  while (true) {
    try {
      return db.transaction(fn).immediate()
    } catch (err: any) {
      if (
        attempts < 3 &&
        (err?.code === 'SQLITE_BUSY' ||
          err?.message?.includes('busy') ||
          err?.message?.includes('locked'))
      ) {
        attempts++
        Bun.sleepSync(attempts * 25)
        continue
      }
      throw err
    }
  }
}
