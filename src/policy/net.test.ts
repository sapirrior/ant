import { describe, expect, it } from 'bun:test'
import { isPrivateAddress, validatePublicHost } from './net.ts'

describe('net SSRF protection policy', () => {
  it('correctly identifies private IPv4 and IPv6 addresses', () => {
    // Loopback
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('127.0.0.2')).toBe(true)
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('[::1]')).toBe(true)
    expect(isPrivateAddress('::')).toBe(true)

    // Private IPv4 ranges
    expect(isPrivateAddress('10.0.0.1')).toBe(true)
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.255')).toBe(true)
    expect(isPrivateAddress('192.168.1.1')).toBe(true)
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
    expect(isPrivateAddress('169.254.1.1')).toBe(true)
    expect(isPrivateAddress('0.0.0.0')).toBe(true)

    // CGNAT
    expect(isPrivateAddress('100.64.0.1')).toBe(true)
    expect(isPrivateAddress('100.127.255.255')).toBe(true)

    // IPv4-mapped IPv6
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true)

    // Public IPs
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('1.1.1.1')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
    expect(isPrivateAddress('100.128.0.1')).toBe(false)
  })

  it('rejects localhost and private IPs in validatePublicHost', async () => {
    await expect(validatePublicHost('localhost')).rejects.toThrow(/prohibited/)
    await expect(validatePublicHost('127.0.0.1')).rejects.toThrow(/prohibited/)
    await expect(validatePublicHost('169.254.169.254')).rejects.toThrow(/prohibited/)
    await expect(validatePublicHost('[::1]')).rejects.toThrow(/prohibited/)
  })
})
