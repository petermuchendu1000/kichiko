use kengine::workload::*;
use kengine::*;
use std::collections::BTreeMap;
fn main() {
    let name: &'static str = Box::leak(std::env::args().nth(1).unwrap().into_boxed_str());
    let sc = build::<TickLadder>(name, 50_000, 42);
    let mut e = sc.init.clone_reserved();
    let mut errs: BTreeMap<&str, usize> = BTreeMap::new();
    let (mut mk, mut mkf, mut lim, mut limf, mut canc) = (0, 0, 0, 0, 0);
    for op in &sc.ops {
        match op {
            Op::Place(p) => match e.place_order(p) {
                Ok(r) => if p.otype == OrderType::Market { mk += 1; mkf += r.n_fills } else { lim += 1; limf += r.n_fills },
                Err(x) => *errs.entry(x.sqlstate()).or_default() += 1,
            },
            Op::Cancel(u, id) => { if e.cancel_order(*u, *id).is_ok() { canc += 1 } else { *errs.entry("cancel_err").or_default() += 1 } }
            Op::Expire => { e.expire(5000); }
        }
    }
    let d: usize = (0..e.n_books() as u32).map(|b| e.ladder.resting(b, BookSide::Bid) + e.ladder.resting(b, BookSide::Ask)).sum();
    println!("{name}: market {mk} fills/mkt {:.1} | limit {lim} fills/limit {:.2} | cancels {canc} | errs {errs:?} | resting end {d} | cov {:?}", mkf as f64 / mk.max(1) as f64, limf as f64 / lim.max(1) as f64, e.cov);
}
