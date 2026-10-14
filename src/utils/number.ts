export function parseIntStrict(
  name: string,
  raw: string,
  options?: { min?: number; max?: number }
): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid ${name}: "${raw}". Must be a non-negative integer.`)
  }
  const n = Number.parseInt(raw, 10)
  if (options?.min !== undefined && n < options.min) {
    throw new Error(`Invalid ${name}: "${raw}". Must be >= ${options.min}.`)
  }
  if (options?.max !== undefined && n > options.max) {
    throw new Error(`Invalid ${name}: "${raw}". Must be <= ${options.max}.`)
  }
  return n
}
