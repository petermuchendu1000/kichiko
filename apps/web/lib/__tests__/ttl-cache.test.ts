import { describe, it, expect, vi } from 'vitest'
import { TtlCache } from '@/lib/ttl-cache'

describe('TtlCache', () => {
  it('concurrent misses share one load', async () => {
    const c = new TtlCache<number>(1000)
    const load = vi.fn(async () => 7)
    const [a, b] = await Promise.all([c.get('k', load), c.get('k', load)])
    expect([a, b]).toEqual([7, 7])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('serves a hit within the TTL and reloads after it', async () => {
    let t = 0
    const c = new TtlCache<number>(1000, 10, () => t)
    const load = vi.fn(async () => t)
    await c.get('k', load)
    t = 999
    expect(await c.get('k', load)).toBe(0)
    t = 1000
    expect(await c.get('k', load)).toBe(1000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('never caches a failed load or a value the caller rejects', async () => {
    const c = new TtlCache<number | null>(60_000)
    await expect(c.get('k', async () => Promise.reject(new Error('down')))).rejects.toThrow('down')
    expect(await c.get('k', async () => null, (v) => v !== null)).toBeNull()
    expect(await c.get('k', async () => 5, (v) => v !== null)).toBe(5)
  })

  it('evicts the oldest entry past the size cap', async () => {
    const c = new TtlCache<string>(60_000, 2)
    await c.get('a', async () => 'a')
    await c.get('b', async () => 'b')
    await c.get('c', async () => 'c')
    const load = vi.fn(async () => 'a2')
    expect(await c.get('a', load)).toBe('a2')
    expect(load).toHaveBeenCalledTimes(1)
  })
})
