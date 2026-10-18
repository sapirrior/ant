import dns from 'node:dns/promises'

export function isPrivateAddress(ip: string): boolean {
  const clean = ip
    .replace(/^\[|\]$/g, '')
    .trim()
    .toLowerCase()

  // IPv4 mapped IPv6 e.g. ::ffff:127.0.0.1
  if (clean.startsWith('::ffff:')) {
    return isPrivateAddress(clean.slice(7))
  }

  // IPv4 check
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) {
    const parts = clean.split('.').map(Number)
    const [a, b] = parts
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true
    if (a !== undefined && a >= 224) return true
    return false
  }

  // IPv6 check
  if (clean === '::' || clean === '::1') return true
  if (/^f[cd][0-9a-f]{2}:/i.test(clean) || clean.startsWith('fc') || clean.startsWith('fd'))
    return true
  if (/^fe[89ab][0-9a-f]:/i.test(clean) || clean.startsWith('fe80:')) return true

  return false
}

export type HostLookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>

export async function validatePublicHost(
  hostname: string,
  lookupFn: HostLookupFn = (host, opts) => dns.lookup(host, opts),
): Promise<string[]> {
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .trim()
    .toLowerCase()
  if (host === 'localhost' || isPrivateAddress(host)) {
    throw new Error(`Access to local or private network address "${hostname}" is prohibited.`)
  }

  try {
    const records = await lookupFn(host, { all: true })
    if (!records || records.length === 0) {
      throw new Error(`Failed to resolve host "${hostname}": no addresses found`)
    }
    for (const record of records) {
      if (isPrivateAddress(record.address)) {
        throw new Error(
          `Access to local or private network address "${record.address}" (resolved from ${hostname}) is prohibited.`,
        )
      }
    }
    return records.map((record) => record.address)
  } catch (err: any) {
    if (err.message?.includes('prohibited')) throw err
    // If lookup fails, let caller know
    throw new Error(`Failed to resolve host "${hostname}": ${err.message}`)
  }
}
