// lib/ttl-cache.ts
// ------------------------------------------------------------
// In-process read-through cache with a TTL and single flight: concurrent misses
// for one key share one load. For hot, short-lived values where a network cache
// (lib/cache, Redis over REST) would cost as much as the load it saves.
// A failed load is never cached. Size is capped: the oldest entry is evicted.

export class TtlCache<V> {
  private values = new Map<string, { at: number; value: V }>()
  private inflight = new Map<string, Promise<V>>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get(key: string, load: () => Promise<V>, shouldCache: (v: V) => boolean = () => true): Promise<V> {
    const hit = this.values.get(key)
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value
    const pending = this.inflight.get(key)
    if (pending) return pending
    const p = load()
      .then((value) => {
        if (shouldCache(value)) {
          this.values.delete(key)
          this.values.set(key, { at: this.now(), value })
          if (this.values.size > this.maxEntries) {
            const oldest = this.values.keys().next().value
            if (oldest !== undefined) this.values.delete(oldest)
          }
        }
        return value
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }
}
