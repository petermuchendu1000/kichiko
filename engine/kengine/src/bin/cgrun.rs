//! cgrun <scenario> <btree|tick> <nops>: build the scenario (identical work
//! for any nops of the same stream prefix) and replay `nops` ops. Run under
//! cachegrind/callgrind with nops=0 and nops=N; the difference / N is the
//! per-op cost of the replay alone. `replay_ops` is the callgrind toggle point.
use kengine::workload::{apply, build, Op};
use kengine::{BTreeLadder, Engine, Ladder, TickLadder};

#[inline(never)]
#[no_mangle]
pub fn replay_ops_btree(e: &mut Engine<BTreeLadder>, ops: &[Op]) -> usize {
    ops.iter().map(|op| apply(e, op)).sum()
}
#[inline(never)]
#[no_mangle]
pub fn replay_ops_tick(e: &mut Engine<TickLadder>, ops: &[Op]) -> usize {
    ops.iter().map(|op| apply(e, op)).sum()
}

fn go<L: Ladder>(name: &'static str, total: usize, n: usize, f: fn(&mut Engine<L>, &[Op]) -> usize) {
    // always build the full stream so the setup work is identical for every n
    let sc = build::<L>(name, total, 42);
    let mut e = sc.init.clone_reserved();
    let fills = f(&mut e, &sc.ops[..n]);
    eprintln!("{name} {} ops={n} fills={fills}", L::NAME);
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let name: &'static str = Box::leak(a[1].clone().into_boxed_str());
    let n: usize = a[3].parse().unwrap();
    let total: usize = a.get(4).map(|x| x.parse().unwrap()).unwrap_or(20_000);
    match a[2].as_str() {
        "btree" => go::<BTreeLadder>(name, total, n, replay_ops_btree),
        _ => go::<TickLadder>(name, total, n, replay_ops_tick),
    }
}
