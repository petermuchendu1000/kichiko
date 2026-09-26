//! Hot-path allocation check with a counting global allocator: after warm-up,
//! the TickLadder engine must perform ZERO heap allocations per operation
//! (place incl. sweeps, cancel, expire), for every benchmark scenario.
use kengine::workload::{apply, build, SCENARIOS};
use kengine::{BTreeLadder, Ladder, TickLadder};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};

struct Counting;
static ALLOCS: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Relaxed);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Relaxed);
        System.realloc(p, l, n)
    }
}
#[global_allocator]
static A: Counting = Counting;

fn count<L: Ladder>(name: &'static str) -> (usize, usize) {
    let sc = build::<L>(name, 60_000, 5);
    let mut e = sc.init.clone_reserved();
    let (warm, hot) = sc.ops.split_at(20_000);
    for op in warm {
        apply(&mut e, op);
    }
    let before = ALLOCS.load(Relaxed);
    let mut fills = 0;
    for op in hot {
        fills += apply(&mut e, op);
    }
    (ALLOCS.load(Relaxed) - before, fills)
}

#[test]
fn tick_ladder_hot_path_does_not_allocate() {
    for name in SCENARIOS {
        let (t, f) = count::<TickLadder>(name);
        let (b, _) = count::<BTreeLadder>(name);
        println!("{name:<13} 40000 ops, {f} fills: allocations tick={t} btree={b}");
        assert_eq!(t, 0, "{name}: TickLadder allocated on the hot path");
    }
}
