# Comment thread — head-to-head capture, 2026-10-16

Matrix **C11** (comment volume). Captured and measured before any code was
opened, the way section C was worked.

## What was captured

| key | page |
|---|---|
| `PM` | `polymarket.com/event/brazil-presidential-election` — **24,024 comments**, the direct analogue of `ke-2027-president` |
| `EL` | our `/markets/ke-2027-president` — 36 comments, our largest thread |

The PM slug came from `gamma-api.polymarket.com/events?order=commentCount`,
not from guessing. Desktop 1440×900 and mobile 390×844; ours in both schemes.

## Polymarket, measured

* their own client asks for **`limit=10&offset=0&order=createdAt&ascending=false`**
* **one** comments request in the page's whole lifetime — no polling, and **no
  realtime stream of the thread at all**
* the other 24,014 sit behind an explicit **"Show more"**
  (`div.flex.justify-center.w-full.py-4`, 72 px) at the tail of the list
* first page **27,859 B**; thread **1,476 px of a 4,359 px document = 33.9%**
* their comments payload carries `get_positions=true` — the commenter's
  position arrives **with** the comment, in one round trip (we use a separate
  RPC, deliberately: see C10 on why we publish side and never size)

The button could not be operated headlessly — an overlay intercepts the click,
and three attempts timed out. So this records that the affordance exists and
takes `offset`; it does **not** claim to have paged their thread.

## Two instrument failures, both caught before they became findings

**The harness scrolled the window.** PM's thread lives in its own scroll
container, so five passes to the bottom of the document moved nothing and
fetched nothing. Left alone, that would have been written up as "PM loads
everything at once" — the opposite of the truth. Re-run against the real
container, and then against their own `.comment` class names rather than a
guessed selector.

**Six screenshots of the footer.** `clipThread()` computed the clip box in
document coordinates and handed it to `page.screenshot({clip})`, which is
viewport-relative without `fullPage: true`. Every file had plausible dimensions
(840×2906, 374×3580) and every one showed the site footer. Caught only by
opening them. Same class as the census that could not see PM's order ticket.

## Ours, before and after

| | before | after |
|---|---|---|
| rendered rows | 36 (all) | 22 (20 roots + replies) |
| thread height | 3,087 px of 5,830 = **52.9%** | 1,873 px of 4,676 = **40.1%** |
| load requests | full thread, 13 supabase calls | **1** page RPC, 9,572 B |
| idle 6 s | 0 | 0 |
| **one new comment, per viewer** | **22,916 B** | **384 B** |

The 61% figure this was carried at before is wrong; 52.9% is the measurement.

## Files

```
harness/pm-comments.js    first PM pass — kept because its failure is the point
harness/pm-comments2.js   the pass that scrolls the real container
harness/ours-refetch.js   two live viewers + one SQL insert: the amplification
harness/ours-after.js     the same measurement re-run after 116/117
harness/shots.js          clipped section shots, both schemes, both viewports
```

`ours-refetch.js` needs a writer, so it is run by hand against a dev server
with a comment inserted out-of-band; it is **not** in CI. The load path, the
paging, the sort and the idle thread are gated in
`apps/web/e2e/comment-paging.spec.ts`.
