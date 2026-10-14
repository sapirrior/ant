import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Returns the ANT_HOME directory path.
 * Respects process.env.ANT_HOME if non-empty, otherwise defaults to ~/.ant.
 */
export function getAntHome(): string {
  const env = process.env.ANT_HOME
  return env && env.trim() !== '' ? resolve(env) : join(homedir(), '.ant')
}
