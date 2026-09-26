// Rust port of FastBook<true> (bitmap) from book.cpp; replays the same command stream and must
// print the same fill hash. CHECKED=true uses bounds-checked indexing, false uses get_unchecked.
use std::time::Instant;

const NIL: u32 = u32::MAX;
const NTICK: usize = 1024;
const BID: usize = 0;
const ASK: usize = 1;

#[repr(C)]
#[derive(Clone, Copy)]
struct Cmd { typ: u8, side: u8, tick: u16, acct: u32, qty: u64, oid: u64, handle: u32, _pad: u32 }

#[repr(C, align(32))]
#[derive(Clone, Copy)]
struct Order { qty: u64, oid: u64, next: u32, prev: u32, acct: u32, tick: u16, side: u8, kind: u8 }

#[derive(Clone, Copy)]
struct Level { head: u32, tail: u32, qty: u64 }

#[repr(C, align(64))]
struct Ladder { summary: u64, _pad: [u64; 7], bits: [u64; NTICK / 64], lv: [Level; NTICK] }

struct Book<const CHECKED: bool> {
    l: [Box<Ladder>; 2],
    best: [i32; 2],
    pool: Vec<Order>,
    free_head: u32,
    live: u32,
    hash: u64,
    nfills: u64,
}

#[inline(always)]
fn mix(h: u64, v: u64) -> u64 { h ^ (v.wrapping_add(0x9e3779b97f4a7c15).wrapping_add(h << 6).wrapping_add(h >> 2)) }

macro_rules! P { ($s:ident, $i:expr) => { if CHECKED { &mut $s.pool[$i as usize] } else { unsafe { $s.pool.get_unchecked_mut($i as usize) } } } }
macro_rules! LV { ($s:ident, $side:expr, $t:expr) => { if CHECKED { &mut $s.l[$side].lv[$t as usize] } else { unsafe { $s.l.get_unchecked_mut($side).lv.get_unchecked_mut($t as usize) } } } }

impl<const CHECKED: bool> Book<CHECKED> {
    fn new(cap: u32) -> Self {
        let mk = || Box::new(Ladder { summary: 0, _pad: [0; 7], bits: [0; NTICK / 64], lv: [Level { head: NIL, tail: NIL, qty: 0 }; NTICK] });
        let mut pool = vec![Order { qty: 0, oid: 0, next: NIL, prev: NIL, acct: 0, tick: 0, side: 0, kind: 0 }; cap as usize];
        for i in 0..cap { pool[i as usize].next = if i + 1 < cap { i + 1 } else { NIL }; }
        Book { l: [mk(), mk()], best: [-1, NTICK as i32], pool, free_head: 0, live: 0, hash: 0, nfills: 0 }
    }
    #[inline(always)] fn set_bit(&mut self, s: usize, t: usize) { self.l[s].bits[t >> 6] |= 1u64 << (t & 63); self.l[s].summary |= 1u64 << (t >> 6); }
    #[inline(always)] fn clear_bit(&mut self, s: usize, t: usize) {
        self.l[s].bits[t >> 6] &= !(1u64 << (t & 63));
        if self.l[s].bits[t >> 6] == 0 { self.l[s].summary &= !(1u64 << (t >> 6)); }
    }
    #[inline(always)] fn scan_best(&self, s: usize) -> i32 {
        let sm = self.l[s].summary;
        if s == BID {
            if sm == 0 { return -1; }
            let w = 63 - sm.leading_zeros() as usize;
            (w * 64 + 63 - self.l[s].bits[w].leading_zeros() as usize) as i32
        } else {
            if sm == 0 { return NTICK as i32; }
            let w = sm.trailing_zeros() as usize;
            (w * 64 + self.l[s].bits[w].trailing_zeros() as usize) as i32
        }
    }
    #[inline(always)] fn free_slot(&mut self, i: u32) { let fh = self.free_head; let o = P!(self, i); o.oid = 0; o.next = fh; self.free_head = i; self.live -= 1; }

    fn limit(&mut self, side: usize, tick: u16, mut qty: u64, oid: u64, acct: u32) -> u32 {
        let opp = side ^ 1;
        while qty != 0 {
            let b = self.best[opp];
            let crosses = if side == BID { b <= tick as i32 } else { b >= tick as i32 };
            if !crosses || b < 0 || b >= NTICK as i32 { break; }
            let mut i = LV!(self, opp, b).head;
            while qty != 0 && i != NIL {
                let (nx, macct, mqty, moid) = { let m = P!(self, i); (m.next, m.acct, m.qty, m.oid) };
                if macct == acct {
                    { let lv = LV!(self, opp, b); lv.qty -= mqty; lv.head = nx; if nx == NIL { lv.tail = NIL; } }
                    if nx != NIL { P!(self, nx).prev = NIL; }
                    self.free_slot(i); i = nx; continue;
                }
                let f = if mqty < qty { mqty } else { qty };
                qty -= f;
                { let m = P!(self, i); m.qty -= f; }
                LV!(self, opp, b).qty -= f;
                self.hash = mix(self.hash, moid ^ (oid << 20) ^ (f << 1) ^ (b as u64)); self.nfills += 1;
                if mqty == f {
                    { let lv = LV!(self, opp, b); lv.head = nx; if nx == NIL { lv.tail = NIL; } }
                    if nx != NIL { P!(self, nx).prev = NIL; }
                    self.free_slot(i); i = nx;
                } else { break; }
            }
            if LV!(self, opp, b).head == NIL { self.clear_bit(opp, b as usize); self.best[opp] = self.scan_best(opp); }
        }
        if qty == 0 { return NIL; }
        let i = self.free_head;
        if i == NIL { return NIL; }
        self.free_head = P!(self, i).next; self.live += 1;
        let tail = LV!(self, side, tick).tail;
        { let o = P!(self, i); o.qty = qty; o.oid = oid; o.acct = acct; o.tick = tick; o.side = side as u8; o.kind = 0; o.next = NIL; o.prev = tail; }
        if tail != NIL { P!(self, tail).next = i; } else { LV!(self, side, tick).head = i; self.set_bit(side, tick as usize); }
        { let lv = LV!(self, side, tick); lv.tail = i; lv.qty += qty; }
        if side == BID { if tick as i32 > self.best[BID] { self.best[BID] = tick as i32; } }
        else if (tick as i32) < self.best[ASK] { self.best[ASK] = tick as i32; }
        i
    }

    fn cancel(&mut self, h: u32, oid: u64) -> bool {
        if h as usize >= self.pool.len() { return false; }
        let (prev, next, s, t, q) = { let o = P!(self, h); if o.oid != oid { return false; } (o.prev, o.next, o.side as usize, o.tick, o.qty) };
        if prev != NIL { P!(self, prev).next = next; } else { LV!(self, s, t).head = next; }
        if next != NIL { P!(self, next).prev = prev; } else { LV!(self, s, t).tail = prev; }
        LV!(self, s, t).qty -= q;
        self.free_slot(h);
        if LV!(self, s, t).head == NIL { self.clear_bit(s, t as usize); if t as i32 == self.best[s] { self.best[s] = self.scan_best(s); } }
        true
    }
}

fn run<const C: bool>(label: &str, cmds: &[Cmd], skip: usize) {
    let mut b = Book::<C>::new(1 << 21);
    for c in &cmds[..skip] { b.limit(c.side as usize, c.tick, c.qty, c.oid, c.acct); }
    let mut rej = 0u64;
    let t0 = Instant::now();
    for c in &cmds[skip..] {
        if c.typ == 0 { b.limit(c.side as usize, c.tick, c.qty, c.oid, c.acct); } else if !b.cancel(c.handle, c.oid) { rej += 1; }
    }
    let dt = t0.elapsed().as_nanos() as f64;
    let n = (cmds.len() - skip) as f64;
    println!("{:<14} ops={} {:.1} ns/op {:.2} M ops/s fills={} rej={} hash={:016x}", label, n, dt / n, n / dt * 1e3, b.nfills, rej, b.hash);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let data = std::fs::read(&args[1]).unwrap();
    let skip = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
    let cnt = u64::from_le_bytes(data[8..16].try_into().unwrap()) as usize;
    let mut cmds: Vec<Cmd> = Vec::with_capacity(cnt);
    unsafe { std::ptr::copy_nonoverlapping(data[16..].as_ptr() as *const Cmd, cmds.as_mut_ptr(), cnt); cmds.set_len(cnt); }
    let which = args.get(2).map(|s| s.as_str()).unwrap_or("both");
    if which != "unchecked" { run::<true>("rust_checked", &cmds, skip); }
    if which != "checked" { run::<false>("rust_unchecked", &cmds, skip); }
}
