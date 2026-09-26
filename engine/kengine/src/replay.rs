//! Replay of a recorded differential stream (JSON produced by the SQL harness)
//! through the twin, producing results in the same canonical shape.
use crate::engine::*;
use crate::num::Num;
use crate::Ladder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Deserialize, Serialize, Clone)]
pub struct UserSpec {
    pub rate: String,
    pub available: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct OpSpec {
    pub k: String,
    #[serde(default)]
    pub u: u32,
    #[serde(default)]
    pub opt: u32,
    #[serde(default)]
    pub side: String,
    #[serde(default)]
    pub act: String,
    #[serde(default, rename = "type")]
    pub otype: String,
    #[serde(default)]
    pub price: Option<String>,
    #[serde(default)]
    pub size: String,
    #[serde(default)]
    pub spend: Option<String>,
    #[serde(default)]
    pub exp_us: Option<i64>,
    /// cancel target: op index of the placing op, or -1 for a random uuid
    #[serde(default, rename = "ref")]
    pub target: i64,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Stream {
    pub tick_size: String,
    pub min_order_size: String,
    pub n_options: u32,
    pub now_us: i64,
    pub users: Vec<UserSpec>,
    pub ops: Vec<OpSpec>,
}

fn s6(m: i128) -> String {
    Num::new(m, 6).to_string()
}

pub fn run<L: Ladder>(st: &Stream) -> Value {
    let cfg = Config { keep_history: true, rate_limit: false, ..Config::default() };
    let mut e: Engine<L> = Engine::new(cfg, st.ops.len() + 16);
    e.now = st.now_us;
    let m = e.add_market(Market {
        tick_size: Num::parse(&st.tick_size),
        min_order_size: Num::parse(&st.min_order_size),
        closes_at: i64::MAX,
        active: true,
    });
    for u in &st.users {
        let a = Num::parse(&u.available).n20_6();
        e.add_user(Wallet { available: a, reserved: 0, rate: Num::parse(&u.rate) });
    }
    for _ in 0..st.n_options {
        e.add_option(m);
    }
    let mut id_of: HashMap<usize, OrderId> = HashMap::new();
    let mut s_of: HashMap<OrderId, usize> = HashMap::new();
    let mut results = vec![];
    for (s, op) in st.ops.iter().enumerate() {
        match op.k.as_str() {
            "place" => {
                let req = PlaceOrder {
                    user: op.u,
                    book: op.opt,
                    outcome: if op.side == "yes" { Outcome::Yes } else { Outcome::No },
                    action: if op.act == "buy" { Action::Buy } else { Action::Sell },
                    otype: if op.otype == "limit" { OrderType::Limit } else { OrderType::Market },
                    price: op.price.as_deref().map(Num::parse),
                    size: Num::parse(&op.size),
                    max_spend_usd: op.spend.as_deref().map(Num::parse),
                    expires_at: op.exp_us,
                };
                match e.place_order(&req) {
                    Ok(r) => {
                        id_of.insert(s, r.order);
                        s_of.insert(r.order, s);
                        let fills: Vec<Value> = e
                            .last_fills()
                            .iter()
                            .map(|f| {
                                json!([s_of[&f.maker], Num::new(f.price as i128, 1).to_string(), s6(f.size), f.kind.as_str()])
                            })
                            .collect();
                        results.push(json!({"s": s, "status": r.status.as_str(), "filled": s6(r.filled),
                            "rest": s6(r.resting), "cash": r.cash_local.to_string(), "fills": fills}));
                    }
                    Err(err) => results.push(json!({"s": s, "err": err.sqlstate()})),
                }
            }
            "cancel" => {
                let id = if op.target < 0 { NO_ORDER } else { *id_of.get(&(op.target as usize)).unwrap_or(&NO_ORDER) };
                match e.cancel_order(op.u, id) {
                    Ok(c) => results.push(json!({"s": s, "released_shares": c.released_shares.to_string(),
                        "released_local": c.released_local.to_string()})),
                    Err(err) => results.push(json!({"s": s, "err": err.sqlstate()})),
                }
            }
            "expire" => {
                let n = e.expire(5000);
                results.push(json!({"s": s, "expired": n}));
            }
            k => panic!("unknown op {k}"),
        }
    }
    let mut orders = serde_json::Map::new();
    let mut keys: Vec<_> = id_of.keys().copied().collect();
    keys.sort();
    for s in keys {
        let o = e.order(id_of[&s]).unwrap();
        orders.insert(s.to_string(), json!([o.status.as_str(), s6(o.filled), s6(o.reserved_usd), s6(o.reserved_local)]));
    }
    let mut positions = vec![];
    for u in 0..e.n_users() as u32 {
        for b in 0..e.n_books() as u32 {
            for oc in [Outcome::No, Outcome::Yes] {
                let p = e.position(u, b, oc);
                if p.exists {
                    positions.push(json!([u, b, oc.as_str(), s6(p.shares), s6(p.reserved_shares),
                        s6(p.total_invested_usd), s6(p.avg_entry_price), s6(p.current_value_usd),
                        s6(p.realized_pnl_usd), s6(p.total_payout_usd), p.is_active]));
                }
            }
        }
    }
    let wallets: Vec<Value> = (0..e.n_users() as u32)
        .map(|u| json!([u, s6(e.wallet(u).available), s6(e.wallet(u).reserved)]))
        .collect();
    let c = e.cov;
    json!({"results": results, "orders": orders, "positions": positions, "wallets": wallets,
           "coverage": {"self_trade_skips": c.self_trade_skips, "expired_skips": c.expired_skips,
                        "budget_trims": c.budget_trims, "budget_stops": c.budget_stops,
                        "makers_filled": c.makers_filled, "market_sell_releases": c.market_sell_releases,
                        "unbacked_makers": c.unbacked_makers}})
}
