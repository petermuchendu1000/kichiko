import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBookPoller } from '@/lib/book-poller'

const URL_A = '/api/markets/m/book?option=o&side=yes'
const book = { asks: [], bids: [] }

function setup(delayMs = 0) {
  let hidden = false
  let onVis: () => void = () => {}
  const fetch = vi.fn(
    () =>
      new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) =>
        setTimeout(() => resolve({ ok: true, status: 200, json: async () => book }), delayMs),
      ),
  )
  const poller = createBookPoller({
    fetch,
    isHidden: () => hidden,
    onVisibilityChange: (cb) => {
      onVis = cb
    },
    now: () => Date.now(),
    intervalMs: 4000,
  })
  return {
    poller,
    fetch,
    setHidden(h: boolean) {
      hidden = h
      onVis()
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('book poller', () => {
  it('components showing the same book share one request per tick', async () => {
    const { poller, fetch } = setup()
    const offA = poller.subscribe(URL_A, () => {})
    const offB = poller.subscribe(URL_A, () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(poller.getSnapshot(URL_A).book).toEqual(book)
    offA()
    offB()
  })

  it('never overlaps: a slow response delays the next poll instead of stacking requests', async () => {
    const { poller, fetch } = setup(9000)
    const off = poller.subscribe(URL_A, () => {})
    await vi.advanceTimersByTimeAsync(8999)
    expect(fetch).toHaveBeenCalledTimes(1) // setInterval(4000) would have fired twice more
    await vi.advanceTimersByTimeAsync(1 + 3999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    off()
  })

  it('pauses while the page is hidden and refreshes when it is shown again', async () => {
    const { poller, fetch, setHidden } = setup()
    const off = poller.subscribe(URL_A, () => {})
    await vi.advanceTimersByTimeAsync(0)
    setHidden(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    setHidden(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(2)
    off()
  })

  it('stops when the last subscriber leaves, and reuses a fresh snapshot on return', async () => {
    const { poller, fetch } = setup()
    const off = poller.subscribe(URL_A, () => {})
    await vi.advanceTimersByTimeAsync(0)
    off()
    await vi.advanceTimersByTimeAsync(2000)
    const again = poller.subscribe(URL_A, () => {})
    expect(poller.getSnapshot(URL_A).book).toEqual(book) // rendered at once
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1) // still fresh: no extra request
    again()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the last book and reports an error when a poll fails', async () => {
    const { poller, fetch } = setup()
    const off = poller.subscribe(URL_A, () => {})
    await vi.advanceTimersByTimeAsync(0)
    fetch.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    await vi.advanceTimersByTimeAsync(4000)
    const snap = poller.getSnapshot(URL_A)
    expect(snap.error).toBe('Could not load the order book')
    expect(snap.book).toEqual(book)
    off()
  })
})
