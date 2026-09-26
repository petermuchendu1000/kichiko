//! Criterion wall-clock per operation, both ladders, five scenarios.
//! Each measurement replays a pre-generated, state-aware op stream on a fresh
//! clone of the scenario's warmed-up initial engine (clone/drop untimed).
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use kengine::workload::{apply, build, Scenario, SCENARIOS};
use kengine::{BTreeLadder, Ladder, TickLadder};
use std::hint::black_box;
use std::time::{Duration, Instant};

const NOPS: usize = 20_000;

fn run<L: Ladder>(c: &mut Criterion, name: &'static str) {
    let sc: Scenario<L> = build::<L>(name, NOPS, 42);
    let mut g = c.benchmark_group(name);
    g.throughput(Throughput::Elements(1));
    g.sample_size(30).measurement_time(Duration::from_secs(4)).warm_up_time(Duration::from_secs(1));
    g.bench_function(BenchmarkId::new(L::NAME, "op"), |b| {
        b.iter_custom(|iters| {
            let mut total = Duration::ZERO;
            let mut done = 0u64;
            while done < iters {
                let mut e = sc.init.clone_reserved();
                let n = (iters - done).min(sc.ops.len() as u64) as usize;
                let t = Instant::now();
                for op in &sc.ops[..n] {
                    black_box(apply(&mut e, black_box(op)));
                }
                total += t.elapsed();
                done += n as u64;
                drop(e);
            }
            total
        })
    });
    g.finish();
}

/// Ladder-only micro-benchmarks (no money arithmetic): isolates the data
/// structure. 3,000 resting orders.
fn ladder<L: Ladder>(c: &mut Criterion) {
    use kengine::workload::Rng;
    use kengine::BookSide;
    // (a) FIFO-middle cancel+re-insert: 3,000 orders on 20 levels (150/level)
    let mut l = L::with_capacity(8192);
    l.add_book();
    let mut r = Rng(99);
    let mut live: Vec<(u16, u64, u32)> = (0..3000u64)
        .map(|i| {
            let px = 490 + (r.below(20) as u16);
            (px, i, l.insert(0, BookSide::Ask, px, i))
        })
        .collect();
    let mut g = c.benchmark_group("ladder");
    g.sample_size(30).measurement_time(Duration::from_secs(3)).warm_up_time(Duration::from_secs(1));
    g.bench_function(BenchmarkId::new(L::NAME, "cancel_reinsert_150_per_level"), |b| {
        b.iter(|| {
            let i = r.below(live.len() as u64) as usize;
            let (px, id, h) = live[i];
            l.remove(0, BookSide::Ask, px, id, h);
            let h2 = l.insert(0, BookSide::Ask, px, id);
            live[i] = (px, id, h2);
        })
    });
    // (b) walk the first 10 orders of a 3,000-deep book spread over ~800 levels
    let mut l2 = L::with_capacity(8192);
    l2.add_book();
    for i in 0..3000u64 {
        let px = 100 + (r.below(800) as u16);
        l2.insert(0, BookSide::Ask, px, i);
        l2.insert(0, BookSide::Bid, px, i + 10_000);
    }
    g.bench_function(BenchmarkId::new(L::NAME, "walk_top10_of_3000"), |b| {
        b.iter(|| {
            let mut n = 0;
            l2.walk(0, BookSide::Ask, 999, |o| { n += 1; black_box(o); n < 10 });
            let mut m = 0;
            l2.walk(0, BookSide::Bid, 1, |o| { m += 1; black_box(o); m < 10 });
            n + m
        })
    });
    // (c) best-price search on a sparse book (orders only at 1c and 99.9c)
    let mut l3 = L::with_capacity(64);
    l3.add_book();
    l3.insert(0, BookSide::Ask, 999, 1);
    l3.insert(0, BookSide::Bid, 1, 2);
    g.bench_function(BenchmarkId::new(L::NAME, "sparse_best_bid_ask"), |b| {
        b.iter(|| (black_box(l3.best(0, BookSide::Ask)), black_box(l3.best(0, BookSide::Bid))))
    });
    g.finish();
}

fn benches(c: &mut Criterion) {
    ladder::<BTreeLadder>(c);
    ladder::<TickLadder>(c);
    for name in SCENARIOS {
        run::<BTreeLadder>(c, name);
        run::<TickLadder>(c, name);
    }
}

criterion_group!(b, benches);
criterion_main!(b);
