//! Order-book ladders. One "book" per (market, option); each book has a bid
//! side and an ask side keyed by the YES-perspective price in deci-cents
//! (yes_px 1..=999, i.e. 0.1c .. 99.9c), FIFO (= created_at ASC) within a
//! level. This is exactly the order of the 071 partial indexes:
//!   asks (yes_px ASC,  created_at ASC)   bids (yes_px DESC, created_at ASC)
//!
//! The ladder only stores order ids; eligibility filters (self-trade, expiry)
//! and all money live in the engine.

use std::collections::{BTreeMap, VecDeque};

/// yes_px range 0..=1000 (only 1..=999 is ever used), padded to 1024 slots.
pub const NPX: usize = 1024;
const NIL: u32 = u32::MAX;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum BookSide {
    Bid = 0,
    Ask = 1,
}

pub trait Ladder: Clone {
    const NAME: &'static str;
    /// `order_capacity` is a hint for pre-allocation (no allocation on the hot
    /// path while the number of resting orders stays below it).
    fn with_capacity(order_capacity: usize) -> Self;
    /// Add a new (market, option) book; returns its index.
    fn add_book(&mut self) -> u32;
    /// Append `order` at the tail of level `px`; returns an opaque handle that
    /// must be passed back to `remove`.
    fn insert(&mut self, book: u32, side: BookSide, px: u16, order: u64) -> u32;
    fn remove(&mut self, book: u32, side: BookSide, px: u16, order: u64, handle: u32);
    /// Visit resting orders in priority order. Asks: px ascending while
    /// px <= limit. Bids: px descending while px >= limit. The visitor
    /// returns false to stop. The ladder must not be mutated during a walk.
    fn walk<F: FnMut(u64) -> bool>(&self, book: u32, side: BookSide, limit: u16, f: F);
    fn best(&self, book: u32, side: BookSide) -> Option<u16>;
    fn resting(&self, book: u32, side: BookSide) -> usize;
    /// Clone keeping pre-allocated capacity (Vec::clone shrinks to len).
    fn clone_reserved(&self) -> Self {
        self.clone()
    }
}

// ---------------------------------------------------------------------------
// (a) Baseline: BTreeMap<price, VecDeque<order>>
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
pub struct BTreeLadder {
    books: Vec<[BTreeMap<u16, VecDeque<u64>>; 2]>,
    counts: Vec<[usize; 2]>,
}

impl Ladder for BTreeLadder {
    const NAME: &'static str = "btree";
    fn with_capacity(_c: usize) -> Self {
        Self::default()
    }
    fn add_book(&mut self) -> u32 {
        self.books.push([BTreeMap::new(), BTreeMap::new()]);
        self.counts.push([0, 0]);
        (self.books.len() - 1) as u32
    }
    fn insert(&mut self, book: u32, side: BookSide, px: u16, order: u64) -> u32 {
        self.books[book as usize][side as usize].entry(px).or_default().push_back(order);
        self.counts[book as usize][side as usize] += 1;
        0
    }
    fn remove(&mut self, book: u32, side: BookSide, px: u16, order: u64, _h: u32) {
        let m = &mut self.books[book as usize][side as usize];
        let q = m.get_mut(&px).expect("level missing");
        let i = q.iter().position(|&o| o == order).expect("order missing from level");
        q.remove(i);
        if q.is_empty() {
            m.remove(&px);
        }
        self.counts[book as usize][side as usize] -= 1;
    }
    #[inline]
    fn walk<F: FnMut(u64) -> bool>(&self, book: u32, side: BookSide, limit: u16, mut f: F) {
        let m = &self.books[book as usize][side as usize];
        match side {
            BookSide::Ask => {
                for (_, q) in m.range(..=limit) {
                    for &o in q {
                        if !f(o) {
                            return;
                        }
                    }
                }
            }
            BookSide::Bid => {
                for (_, q) in m.range(limit..).rev() {
                    for &o in q {
                        if !f(o) {
                            return;
                        }
                    }
                }
            }
        }
    }
    fn best(&self, book: u32, side: BookSide) -> Option<u16> {
        let m = &self.books[book as usize][side as usize];
        match side {
            BookSide::Ask => m.keys().next().copied(),
            BookSide::Bid => m.keys().next_back().copied(),
        }
    }
    fn resting(&self, book: u32, side: BookSide) -> usize {
        self.counts[book as usize][side as usize]
    }
}

// ---------------------------------------------------------------------------
// (b) Fixed tick array + intrusive FIFO lists in a u32 slab + 2-level bitmap
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Level {
    head: u32,
    tail: u32,
}
const EMPTY: Level = Level { head: NIL, tail: NIL };

#[derive(Clone, Copy)]
struct Node {
    order: u64,
    prev: u32,
    next: u32,
}

/// Per (book, side): 1024 levels, a 16 x u64 occupancy bitmap and a u16
/// summary (bit w set <=> bitmap word w non-zero). Best-price and next-price
/// search are two tzcnt/lzcnt steps.
#[derive(Clone)]
struct Side {
    levels: Box<[Level; NPX]>,
    bits: [u64; 16],
    summary: u16,
    count: u32,
}

impl Side {
    fn new() -> Self {
        Side { levels: Box::new([EMPTY; NPX]), bits: [0; 16], summary: 0, count: 0 }
    }
    #[inline(always)]
    fn set(&mut self, px: usize) {
        self.bits[px >> 6] |= 1u64 << (px & 63);
        self.summary |= 1u16 << (px >> 6);
    }
    #[inline(always)]
    fn clear(&mut self, px: usize) {
        let w = px >> 6;
        self.bits[w] &= !(1u64 << (px & 63));
        if self.bits[w] == 0 {
            self.summary &= !(1u16 << w);
        }
    }
    /// lowest occupied px >= p
    #[inline(always)]
    fn first_ge(&self, p: usize) -> Option<usize> {
        if p >= NPX {
            return None;
        }
        let w = p >> 6;
        let m = self.bits[w] & (!0u64 << (p & 63));
        if m != 0 {
            return Some((w << 6) | m.trailing_zeros() as usize);
        }
        let s = (self.summary as u32) & (!0u32 << (w + 1));
        if s == 0 {
            return None;
        }
        let w2 = s.trailing_zeros() as usize;
        Some((w2 << 6) | self.bits[w2].trailing_zeros() as usize)
    }
    /// highest occupied px <= p
    #[inline(always)]
    fn last_le(&self, p: usize) -> Option<usize> {
        let p = p.min(NPX - 1);
        let w = p >> 6;
        let m = self.bits[w] & (!0u64 >> (63 - (p & 63)));
        if m != 0 {
            return Some((w << 6) | (63 - m.leading_zeros() as usize));
        }
        let s = (self.summary as u32) & ((1u32 << w) - 1);
        if s == 0 {
            return None;
        }
        let w2 = 31 - s.leading_zeros() as usize;
        Some((w2 << 6) | (63 - self.bits[w2].leading_zeros() as usize))
    }
}

#[derive(Clone)]
pub struct TickLadder {
    sides: Vec<[Side; 2]>,
    nodes: Vec<Node>,
    free: u32,
}

impl TickLadder {
    #[inline(always)]
    fn alloc(&mut self, order: u64) -> u32 {
        if self.free != NIL {
            let i = self.free;
            self.free = self.nodes[i as usize].next;
            self.nodes[i as usize] = Node { order, prev: NIL, next: NIL };
            i
        } else {
            self.nodes.push(Node { order, prev: NIL, next: NIL });
            (self.nodes.len() - 1) as u32
        }
    }
}

impl Ladder for TickLadder {
    const NAME: &'static str = "tick";
    fn with_capacity(c: usize) -> Self {
        TickLadder { sides: Vec::new(), nodes: Vec::with_capacity(c), free: NIL }
    }
    fn add_book(&mut self) -> u32 {
        self.sides.push([Side::new(), Side::new()]);
        (self.sides.len() - 1) as u32
    }
    #[inline]
    fn insert(&mut self, book: u32, side: BookSide, px: u16, order: u64) -> u32 {
        let n = self.alloc(order);
        let s = &mut self.sides[book as usize][side as usize];
        let lv = &mut s.levels[px as usize];
        if lv.tail == NIL {
            lv.head = n;
            lv.tail = n;
            s.set(px as usize);
        } else {
            let t = lv.tail;
            lv.tail = n;
            self.nodes[t as usize].next = n;
            self.nodes[n as usize].prev = t;
        }
        s.count += 1;
        n
    }
    #[inline]
    fn remove(&mut self, book: u32, side: BookSide, px: u16, order: u64, h: u32) {
        let Node { order: o, prev, next } = self.nodes[h as usize];
        debug_assert_eq!(o, order);
        let s = &mut self.sides[book as usize][side as usize];
        let lv = &mut s.levels[px as usize];
        if prev == NIL {
            lv.head = next;
        } else {
            self.nodes[prev as usize].next = next;
        }
        if next == NIL {
            lv.tail = prev;
        } else {
            self.nodes[next as usize].prev = prev;
        }
        if lv.head == NIL {
            s.clear(px as usize);
        }
        s.count -= 1;
        self.nodes[h as usize].next = self.free;
        self.free = h;
    }
    #[inline]
    fn walk<F: FnMut(u64) -> bool>(&self, book: u32, side: BookSide, limit: u16, mut f: F) {
        let s = &self.sides[book as usize][side as usize];
        let limit = limit as usize;
        match side {
            BookSide::Ask => {
                let mut p = s.first_ge(0);
                while let Some(px) = p {
                    if px > limit {
                        return;
                    }
                    let mut n = s.levels[px].head;
                    while n != NIL {
                        let node = &self.nodes[n as usize];
                        if !f(node.order) {
                            return;
                        }
                        n = node.next;
                    }
                    p = s.first_ge(px + 1);
                }
            }
            BookSide::Bid => {
                let mut p = s.last_le(NPX - 1);
                while let Some(px) = p {
                    if px < limit {
                        return;
                    }
                    let mut n = s.levels[px].head;
                    while n != NIL {
                        let node = &self.nodes[n as usize];
                        if !f(node.order) {
                            return;
                        }
                        n = node.next;
                    }
                    if px == 0 {
                        return;
                    }
                    p = s.last_le(px - 1);
                }
            }
        }
    }
    fn best(&self, book: u32, side: BookSide) -> Option<u16> {
        let s = &self.sides[book as usize][side as usize];
        match side {
            BookSide::Ask => s.first_ge(0).map(|x| x as u16),
            BookSide::Bid => s.last_le(NPX - 1).map(|x| x as u16),
        }
    }
    fn resting(&self, book: u32, side: BookSide) -> usize {
        self.sides[book as usize][side as usize].count as usize
    }
    fn clone_reserved(&self) -> Self {
        let mut c = self.clone();
        c.nodes.reserve_exact(self.nodes.capacity() - self.nodes.len());
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect<L: Ladder>(l: &L, side: BookSide, limit: u16) -> Vec<u64> {
        let mut v = vec![];
        l.walk(0, side, limit, |o| {
            v.push(o);
            true
        });
        v
    }

    /// Random insert/remove/walk: both ladders must agree exactly.
    #[test]
    fn ladders_agree() {
        let mut a = BTreeLadder::with_capacity(0);
        let mut b = TickLadder::with_capacity(0);
        a.add_book();
        b.add_book();
        let mut live: Vec<(BookSide, u16, u64, u32)> = vec![];
        let mut x: u64 = 88172645463325252;
        let mut rnd = || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        };
        for id in 0..20000u64 {
            let r = rnd();
            if r % 3 == 0 && !live.is_empty() {
                let i = (rnd() % live.len() as u64) as usize;
                let (s, px, o, h) = live.swap_remove(i);
                a.remove(0, s, px, o, 0);
                b.remove(0, s, px, o, h);
            } else {
                let s = if r & 8 == 0 { BookSide::Bid } else { BookSide::Ask };
                let px = 1 + (rnd() % 999) as u16;
                a.insert(0, s, px, id);
                let h = b.insert(0, s, px, id);
                live.push((s, px, id, h));
            }
            if id % 97 == 0 {
                let lim = 1 + (rnd() % 999) as u16;
                for s in [BookSide::Bid, BookSide::Ask] {
                    assert_eq!(collect(&a, s, lim), collect(&b, s, lim));
                    assert_eq!(a.best(0, s), b.best(0, s));
                    assert_eq!(a.resting(0, s), b.resting(0, s));
                }
            }
        }
    }
}
