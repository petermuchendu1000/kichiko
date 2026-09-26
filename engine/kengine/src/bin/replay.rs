//! replay <stream.json> <out_prefix>: run the recorded stream through both
//! ladders; writes <out_prefix>.btree.json and <out_prefix>.tick.json.
use kengine::{replay, BTreeLadder, TickLadder};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let st: replay::Stream = serde_json::from_str(&std::fs::read_to_string(&a[1]).unwrap()).unwrap();
    let ra = replay::run::<BTreeLadder>(&st);
    let rb = replay::run::<TickLadder>(&st);
    std::fs::write(format!("{}.btree.json", a[2]), serde_json::to_string(&ra).unwrap()).unwrap();
    std::fs::write(format!("{}.tick.json", a[2]), serde_json::to_string(&rb).unwrap()).unwrap();
    let (mut ca, mut cb) = (ra.clone(), rb.clone());
    let cov = ca["coverage"].take();
    cb["coverage"].take();
    println!("ops={} btree==tick: {} coverage={}", st.ops.len(), ca == cb, cov);
    if ca != cb { std::process::exit(1) }
}
