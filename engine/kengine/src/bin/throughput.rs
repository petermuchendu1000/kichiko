//! throughput [scenario] [nops] [reps]: single-core orders/s for both ladders.
use kengine::workload::{apply, build, Op, Scenario};
use kengine::{BTreeLadder, Ladder, TickLadder};
use std::time::Instant;

fn one<L: Ladder>(name: &'static str, nops: usize, reps: usize) {
    let sc: Scenario<L> = build::<L>(name, nops, 7);
    let places = sc.ops.iter().filter(|o| matches!(o, Op::Place(_))).count();
    let mut best = f64::MAX;
    let mut fills = 0;
    for _ in 0..reps {
        let mut e = sc.init.clone_reserved();
        let t = Instant::now();
        let mut f = 0usize;
        for op in &sc.ops {
            f += apply(&mut e, op);
        }
        let dt = t.elapsed().as_secs_f64();
        best = best.min(dt);
        fills = f;
        std::hint::black_box(&e);
    }
    println!(
        "{:<13} {:<6} ops={} (place {}) fills={}  best {:.3}s  {:>10.0} ops/s  {:>10.0} orders/s  {:>7.1} ns/op",
        name, L::NAME, nops, places, fills, best, nops as f64 / best, places as f64 / best, best * 1e9 / nops as f64
    );
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let name: &'static str = Box::leak(a.get(1).cloned().unwrap_or("mixed".into()).into_boxed_str());
    let nops: usize = a.get(2).map(|x| x.parse().unwrap()).unwrap_or(2_000_000);
    let reps: usize = a.get(3).map(|x| x.parse().unwrap()).unwrap_or(3);
    one::<BTreeLadder>(name, nops, reps);
    one::<TickLadder>(name, nops, reps);
}
