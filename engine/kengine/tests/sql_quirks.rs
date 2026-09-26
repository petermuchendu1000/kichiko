//! Engine rules that were once SQL quirks. The twin's contract is fill-for-fill
//! equivalence with the SQL engine, so it changes only when the SQL does.
//! 073 fixed the post-match dust guard firing on LIMIT sells
//! (scripts/repro_limit_sell_p0105.sql shows the pre-073 behaviour).
use kengine::*;

fn setup() -> Engine<TickLadder> {
    let mut e: Engine<TickLadder> = Engine::new(Config::default(), 64);
    let m = e.add_market(Market { tick_size: Num::parse("0.0100"), min_order_size: Num::parse("5.00"), closes_at: i64::MAX, active: true });
    for _ in 0..3 {
        e.add_user(Wallet { available: 1000_000000, reserved: 0, rate: Num::parse("1.00000000") });
    }
    e.add_option(m);
    e
}
fn lim(user: u32, action: Action, px: &str, size: &str) -> PlaceOrder {
    PlaceOrder { user, book: 0, outcome: Outcome::Yes, action, otype: OrderType::Limit, price: Some(Num::parse(px)),
                 size: Num::parse(size), max_spend_usd: None, expires_at: None }
}

#[test]
fn limit_sell_partly_crossing_small_bid_rests_remainder_073() {
    let mut e = setup();
    // users 0 and 2 get 100 YES shares by buying them from user 1 via mints:
    // user 1 bids NO @ 40 (mint counterparty), users 0/2 buy YES @ 60.
    e.place_order(&PlaceOrder { outcome: Outcome::No, ..lim(1, Action::Buy, "40", "200") }).unwrap();
    assert_eq!(e.place_order(&lim(0, Action::Buy, "60", "100")).unwrap().status, Status::Filled);
    assert_eq!(e.place_order(&lim(2, Action::Buy, "60", "100")).unwrap().status, Status::Filled);
    // bidder (1) rests BUY YES 10 @ 60 ($6), user 2 sells 9 into it
    e.place_order(&lim(1, Action::Buy, "60", "10")).unwrap();
    assert_eq!(e.place_order(&lim(2, Action::Sell, "60", "9")).unwrap().status, Status::Filled);
    // $60 LIMIT sell whose immediate fill is 1 share ($0.60): fills 1, rests 99 (073)
    let r = e.place_order(&lim(0, Action::Sell, "60", "100")).unwrap();
    assert_eq!(r.status, Status::PartiallyFilled);
    assert_eq!(e.position(0, 0, Outcome::Yes).reserved_shares, 99_000000);
    // a MARKET sell with dust proceeds is still rejected
    e.place_order(&lim(1, Action::Buy, "50", "11")).unwrap();
    e.place_order(&lim(2, Action::Sell, "50", "10")).unwrap();
    let mkt = PlaceOrder { otype: OrderType::Market, price: None, ..lim(2, Action::Sell, "50", "50") };
    assert_eq!(e.place_order(&mkt).unwrap_err(), EngineError::BelowMinSize);
}
