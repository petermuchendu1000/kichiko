//! Native twin of Kichiko's SQL matching engine.
//!
//! Spec: `clob_place_order` as of migration 071 (index-ordered ladder) and
//! `clob_cancel_order` / `clob_expire_orders` as of 045 (072 does not touch
//! them). Every money expression below is the SQL expression, evaluated with
//! [`Num`] (PostgreSQL numeric semantics, see num.rs), in the same order, with
//! the same rounding-on-assignment to numeric(20,6) / numeric(8,6) /
//! numeric(4,1) columns and variables. Line references (Lnnn) point into
//! supabase/migrations/071_clob_index_ordered_ladder.sql.
//!
//! Execution model: the SQL function runs in one transaction and any RAISE
//! rolls everything back. The twin evaluates in three phases:
//!   1. validation (all pre-match RAISEs, same order as SQL),
//!   2. read-only ladder walk that computes every fill (the walk reads only
//!      maker *orders*, which only this taker touches, each at most once),
//!      then the post-match RAISEs (P0006 buy balance, P0105 sell dust),
//!   3. apply all effects in SQL statement order.
//! Because nothing is mutated before phase 3, an error needs no undo.

use crate::book::{BookSide, Ladder};
use crate::num::Num;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

pub type UserId = u32;
pub type BookId = u32;
/// (generation << 32) | slot
pub type OrderId = u64;
pub const NO_ORDER: OrderId = u64::MAX;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    Yes,
    No,
}
impl Outcome {
    #[inline(always)]
    pub fn comp(self) -> Outcome {
        match self {
            Outcome::Yes => Outcome::No,
            Outcome::No => Outcome::Yes,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Yes => "yes",
            Outcome::No => "no",
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    Buy,
    Sell,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderType {
    Limit,
    Market,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Expired,
}
impl Status {
    #[inline(always)]
    pub fn live(self) -> bool {
        matches!(self, Status::Open | Status::PartiallyFilled)
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Open => "open",
            Status::PartiallyFilled => "partially_filled",
            Status::Filled => "filled",
            Status::Cancelled => "cancelled",
            Status::Expired => "expired",
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MatchKind {
    Direct,
    Mint,
    Burn,
}
impl MatchKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MatchKind::Direct => "direct",
            MatchKind::Mint => "mint",
            MatchKind::Burn => "burn",
        }
    }
}

/// Errors, carrying the SQLSTATE the SQL engine raises.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EngineError {
    MarketNotActive,      // P0001
    MarketClosed,         // P0002
    InsufficientBalance,  // P0006
    OptionNotFound,       // P0007
    BadSize,              // P0102
    PriceOutOfRange,      // P0106 (074)
    NeedPrice,            // P0104
    BelowMinSize,         // P0105
    OrderNotFound,        // P0110
    NotYourOrder,         // P0111
    NotCancellable,       // P0112
    NotEnoughShares,      // P0113
    TooManyOpen,          // P0130
    TooManyOpenMarket,    // P0131
    RateLimited,          // P0132
    NumericOverflow,      // 22003
    CheckViolation,       // 23514
}
impl EngineError {
    pub fn sqlstate(self) -> &'static str {
        use EngineError::*;
        match self {
            MarketNotActive => "P0001",
            MarketClosed => "P0002",
            InsufficientBalance => "P0006",
            OptionNotFound => "P0007",
            BadSize => "P0102",
            PriceOutOfRange => "P0106",
            NeedPrice => "P0104",
            BelowMinSize => "P0105",
            OrderNotFound => "P0110",
            NotYourOrder => "P0111",
            NotCancellable => "P0112",
            NotEnoughShares => "P0113",
            TooManyOpen => "P0130",
            TooManyOpenMarket => "P0131",
            RateLimited => "P0132",
            NumericOverflow => "22003",
            CheckViolation => "23514",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Config {
    /// Keep terminal orders addressable forever (SQL keeps every row). When
    /// false, terminal order slots are recycled (generation-tagged ids) so
    /// memory is bounded; a stale id then cancels with P0112.
    pub keep_history: bool,
    /// 046 limit: max 100 placements per user per 10 s (by created_at).
    pub rate_limit: bool,
    pub max_open_per_user: u32,
    pub max_open_per_user_market: u32,
}
impl Default for Config {
    fn default() -> Self {
        Config { keep_history: true, rate_limit: true, max_open_per_user: 250, max_open_per_user_market: 60 }
    }
}

#[derive(Clone, Debug)]
pub struct Market {
    /// markets.tick_size numeric(6,4): 0.0100 (1c) or 0.0010 (0.1c)
    pub tick_size: Num,
    /// markets.min_order_size numeric(20,2)
    pub min_order_size: Num,
    pub closes_at: i64,
    pub active: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Wallet {
    pub available: i128, // numeric(20,6) mantissa
    pub reserved: i128,  // numeric(20,6)
    /// exchange_rates.rate numeric(20,8) (USD per unit of wallet currency)
    pub rate: Num,
}

/// positions row; all money/shares are numeric(20,6) mantissas, avg is
/// numeric(8,6).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Position {
    pub exists: bool,
    pub shares: i128,
    pub reserved_shares: i128,
    pub total_invested_usd: i128,
    pub avg_entry_price: i128,
    pub current_value_usd: i128,
    pub realized_pnl_usd: i128,
    pub total_payout_usd: i128,
    pub is_active: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Order {
    pub gen: u32,
    pub user: UserId,
    pub book: BookId,
    pub outcome: Outcome,
    pub action: Action,
    pub otype: OrderType,
    pub status: Status,
    /// price_cents numeric(4,1) in deci-cents (0 for market orders = NULL)
    pub price: u16,
    /// ladder handle (TickLadder node index)
    pub handle: u32,
    pub size: i128,
    pub filled: i128,
    pub reserved_usd: i128,
    pub rate: Num,
    pub expires_at: i64, // i64::MAX = NULL
}
impl Order {
    #[inline(always)]
    pub fn book_side(&self) -> BookSide {
        if (self.action == Action::Buy) == (self.outcome == Outcome::Yes) { BookSide::Bid } else { BookSide::Ask }
    }
    #[inline(always)]
    pub fn yes_px(&self) -> u16 {
        if self.outcome == Outcome::Yes { self.price } else { 1000 - self.price }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Fill {
    pub maker: OrderId,
    pub maker_user: UserId,
    /// execution price v_e (deci-cents, taker perspective)
    pub price: u16,
    /// numeric(20,6) mantissa
    pub size: i128,
    pub kind: MatchKind,
    /// v_taker_usd = ROUND(v_fill*v_e/100.0, 8)
    pub taker_usd: Num,
}

#[derive(Clone, Copy, Debug)]
pub struct PlaceOrder {
    pub user: UserId,
    pub book: BookId,
    pub outcome: Outcome,
    pub action: Action,
    pub otype: OrderType,
    /// p_price_cents (any scale); None = NULL
    pub price: Option<Num>,
    /// p_size (any scale)
    pub size: Num,
    /// p_max_spend_usd (any scale)
    pub max_spend_usd: Option<Num>,
    pub expires_at: Option<i64>,
}

#[derive(Clone, Copy, Debug)]
pub struct PlaceResult {
    pub order: OrderId,
    pub status: Status,
    pub filled: i128,
    pub resting: i128,
    /// v_cash_local (numeric, scale 6 after ROUND)
    pub cash_local: Num,
    pub notional: Num,
    pub n_fills: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct CancelResult {
    /// CASE WHEN sell THEN v_rest ELSE 0 END (literal 0 keeps dscale 0)
    pub released_shares: Num,
    pub released_local: Num,
}

#[derive(Clone, Copy)]
struct BookMeta {
    market: u32,
}

/// Coverage counters (how often each SQL branch was taken); not semantics.
#[derive(Clone, Copy, Debug, Default)]
pub struct Coverage {
    pub self_trade_skips: u64,
    pub expired_skips: u64,
    pub budget_trims: u64,
    pub budget_stops: u64,
    pub makers_filled: u64,
    pub market_sell_releases: u64,
}

const RL_N: usize = 100;
const RL_WINDOW_US: i64 = 10_000_000;

#[derive(Clone)]
pub struct Engine<L: Ladder> {
    pub cfg: Config,
    pub ladder: L,
    markets: Vec<Market>,
    books: Vec<BookMeta>,
    wallets: Vec<Wallet>,
    /// dense: ((user * n_books) + book) * 2 + outcome
    positions: Vec<Position>,
    orders: Vec<Order>,
    free_slots: Vec<u32>,
    open_user: Vec<u32>,
    /// dense: user * n_markets + market
    open_user_market: Vec<u32>,
    /// ring of the last 100 placement times per user (046 rate limit)
    rl_ring: Vec<[i64; RL_N]>,
    rl_head: Vec<u8>,
    expiry: BinaryHeap<Reverse<(i64, OrderId)>>,
    /// wall clock in microseconds: now() of the current transaction
    pub now: i64,
    fills: Vec<Fill>,
    pub cov: Coverage,
}

// literals used by the SQL
const N100_0: Num = Num::new(1000, 1); // 100.0
const N99_9: Num = Num::new(999, 1);
const N0_1: Num = Num::new(1, 1);
const N100: Num = Num::new(100, 0);
const N1E6: Num = Num::new(1_000_000, 0); // '1e6'::numeric has dscale 0

#[inline(always)]
fn n6(m: i128) -> Num {
    Num::new(m, 6)
}
#[inline(always)]
fn px(deci: u16) -> Num {
    Num::new(deci as i128, 1)
}

impl<L: Ladder> Engine<L> {
    pub fn new(cfg: Config, order_capacity: usize) -> Self {
        Engine {
            cfg,
            ladder: L::with_capacity(order_capacity),
            markets: vec![],
            books: vec![],
            wallets: vec![],
            positions: vec![],
            orders: Vec::with_capacity(order_capacity),
            free_slots: Vec::with_capacity(order_capacity),
            open_user: vec![],
            open_user_market: vec![],
            rl_ring: vec![],
            rl_head: vec![],
            expiry: BinaryHeap::with_capacity(order_capacity.min(1 << 20)),
            now: 0,
            fills: Vec::with_capacity(4096),
            cov: Coverage::default(),
        }
    }

    // ---- setup (not hot path) ------------------------------------------

    /// Clone that keeps every pre-allocated capacity (a derived Clone of a Vec
    /// shrinks it to its length, which would re-introduce hot-path growth).
    pub fn clone_reserved(&self) -> Self {
        let mut c = self.clone();
        c.ladder = self.ladder.clone_reserved();
        c.orders.reserve_exact(self.orders.capacity() - self.orders.len());
        c.free_slots.reserve_exact(self.free_slots.capacity() - self.free_slots.len());
        c.expiry.reserve_exact(self.expiry.capacity() - self.expiry.len());
        c.fills.reserve_exact(self.fills.capacity() - self.fills.len());
        c
    }

    pub fn add_user(&mut self, wallet: Wallet) -> UserId {
        let u = self.wallets.len() as u32;
        self.wallets.push(wallet);
        self.open_user.push(0);
        self.rl_ring.push([i64::MIN; RL_N]);
        self.rl_head.push(0);
        self.relayout();
        u
    }
    pub fn add_market(&mut self, m: Market) -> u32 {
        self.markets.push(m);
        self.relayout();
        (self.markets.len() - 1) as u32
    }
    pub fn add_option(&mut self, market: u32) -> BookId {
        let b = self.ladder.add_book();
        self.books.push(BookMeta { market });
        debug_assert_eq!(b as usize, self.books.len() - 1);
        self.relayout();
        b
    }
    fn relayout(&mut self) {
        let (nu, nb, nm) = (self.wallets.len(), self.books.len(), self.markets.len());
        if self.positions.len() != nu * nb * 2 {
            let old_nb = if nu == 0 { 0 } else { self.positions.len() / 2 / nu.max(1) };
            let mut p = vec![Position::default(); nu * nb * 2];
            // only called during setup; re-home existing rows
            if old_nb > 0 {
                let old_nu = self.positions.len() / (old_nb * 2);
                for u in 0..old_nu.min(nu) {
                    for b in 0..old_nb.min(nb) {
                        for s in 0..2 {
                            p[(u * nb + b) * 2 + s] = self.positions[(u * old_nb + b) * 2 + s];
                        }
                    }
                }
            }
            self.positions = p;
        }
        if self.open_user_market.len() != nu * nm {
            self.open_user_market = vec![0; nu * nm];
        }
    }

    // ---- accessors -------------------------------------------------------

    #[inline(always)]
    fn pidx(&self, u: UserId, b: BookId, o: Outcome) -> usize {
        ((u as usize * self.books.len()) + b as usize) * 2 + (o == Outcome::No) as usize
    }
    pub fn position(&self, u: UserId, b: BookId, o: Outcome) -> &Position {
        &self.positions[self.pidx(u, b, o)]
    }
    pub fn wallet(&self, u: UserId) -> &Wallet {
        &self.wallets[u as usize]
    }
    pub fn wallet_mut(&mut self, u: UserId) -> &mut Wallet {
        &mut self.wallets[u as usize]
    }
    pub fn n_users(&self) -> usize {
        self.wallets.len()
    }
    pub fn n_books(&self) -> usize {
        self.books.len()
    }
    pub fn last_fills(&self) -> &[Fill] {
        &self.fills
    }
    #[inline(always)]
    fn slot(id: OrderId) -> usize {
        (id & 0xffff_ffff) as usize
    }
    pub fn order(&self, id: OrderId) -> Option<&Order> {
        let o = self.orders.get(Self::slot(id))?;
        if o.gen == (id >> 32) as u32 { Some(o) } else { None }
    }
    pub fn open_orders_of(&self, u: UserId) -> u32 {
        self.open_user[u as usize]
    }

    // ---- clob_place_order -----------------------------------------------

    pub fn place_order(&mut self, r: &PlaceOrder) -> Result<PlaceResult, EngineError> {
        // [074] p_size := ROUND(p_size, 6): every later use sees the share unit.
        let r = &PlaceOrder { size: r.size.round(6), ..*r };
        let u = r.user as usize;
        let b = r.book as usize;
        if b >= self.books.len() {
            return Err(EngineError::OptionNotFound);
        }
        let mkt = self.books[b].market as usize;
        let nm = self.markets.len();

        // [046] open-order caps + rate limit (L148-L168)
        if self.open_user[u] >= self.cfg.max_open_per_user {
            return Err(EngineError::TooManyOpen);
        }
        if self.open_user_market[u * nm + mkt] >= self.cfg.max_open_per_user_market {
            return Err(EngineError::TooManyOpenMarket);
        }
        if self.cfg.rate_limit {
            // count(created_at > now - 10s) >= 100  <=>  the 100th most recent
            // placement is inside the window
            let oldest = self.rl_ring[u][self.rl_head[u] as usize];
            if oldest > self.now - RL_WINDOW_US {
                return Err(EngineError::RateLimited);
            }
        }
        // validation (L176)
        if !r.size.is_pos() {
            return Err(EngineError::BadSize);
        }
        let market = &self.markets[mkt];
        if !market.active {
            return Err(EngineError::MarketNotActive);
        }
        if market.closes_at < self.now {
            return Err(EngineError::MarketClosed);
        }

        // tick lattice + limit clamp (L190-L197)
        let tick = N0_1.greatest(market.tick_size.mul(N100));
        let limit_c: Num = match r.otype {
            OrderType::Limit => {
                let p = r.price.ok_or(EngineError::NeedPrice)?;
                // [074] reject a limit price outside [0.1, 99.9] cents
                if p.lt(N0_1) || p.gt(N99_9) {
                    return Err(EngineError::PriceOutOfRange);
                }
                let l = p.div(tick).round(0).mul(tick).round(1);
                let l = l.typmod(4, 1).map_err(|_| EngineError::NumericOverflow)?;
                N99_9.least(N0_1.greatest(l)).round(1)
            }
            OrderType::Market => {
                if r.action == Action::Buy { N99_9 } else { N0_1 }
            }
        };
        let limit = limit_c.m as u16; // deci-cents 1..=999
        let wallet = self.wallets[u];
        let rate = wallet.rate;
        let min_usd = market.min_order_size; // COALESCE(min_order_size,0)

        // v_remaining := p_size   (numeric(20,6) assignment, L209)
        let size6 = r.size.typmod(20, 6).map_err(|_| EngineError::NumericOverflow)?.m;

        // [043 #4] min order size (L213-L220)
        let order_usd: Option<Num> = match (r.otype, r.action) {
            (OrderType::Limit, _) => Some(r.size.mul(limit_c).div(N100_0)),
            (OrderType::Market, Action::Buy) => {
                Some(r.max_spend_usd.unwrap_or_else(|| r.size.mul(limit_c).div(N100_0)))
            }
            _ => None,
        };
        if min_usd.is_pos() {
            if let Some(ou) = order_usd {
                if ou.lt(min_usd) {
                    return Err(EngineError::BelowMinSize);
                }
            }
        }

        // SELL: available shares (L223-L236)
        let pi_taker = self.pidx(r.user, r.book, r.outcome);
        if r.action == Action::Sell {
            let p = &self.positions[pi_taker];
            if !p.exists || n6(p.shares - p.reserved_shares).lt(r.size) {
                return Err(EngineError::NotEnoughShares);
            }
        }
        // INSERT clob_orders: size numeric(20,6) CHECK (size > 0) (L245)
        if size6 <= 0 {
            return Err(EngineError::CheckViolation);
        }

        // ---- phase 1: read-only ladder walk (L265-L461) ----------------
        let taker_bid = (r.action == Action::Buy) == (r.outcome == Outcome::Yes);
        let yes_lim: u16 = if r.outcome == Outcome::Yes { limit } else { 1000 - limit };
        let side = if taker_bid { BookSide::Ask } else { BookSide::Bid };
        let now = self.now;
        let taker = r.user;
        let buy = r.action == Action::Buy;
        let budget = if buy { r.max_spend_usd } else { None };

        let mut remaining: i128 = size6;
        let mut filled: i128 = 0;
        let mut spent = Num::ZERO; // v_spent_usd numeric := 0
        let mut notional = Num::ZERO; // v_notional numeric := 0
        let mut cash_delta = Num::ZERO; // v_cash_delta numeric := 0
        self.fills.clear();
        {
            let orders = &self.orders;
            let fills = &mut self.fills;
            let cov = &mut self.cov;
            self.ladder.walk(r.book, side, yes_lim, |oid| {
                if remaining <= 0 {
                    return false; // EXIT WHEN v_remaining <= 0
                }
                let o = &orders[(oid & 0xffff_ffff) as usize];
                // cursor filters: user_id <> p_user_id, not expired
                if o.user == taker {
                    cov.self_trade_skips += 1;
                    return true;
                }
                if o.expires_at <= now {
                    cov.expired_skips += 1;
                    return true;
                }
                let avail = o.size - o.filled;
                if avail <= 0 {
                    return true;
                }
                let mut fill = remaining.min(avail);
                let same = o.outcome == r.outcome;
                let e: u16 = if same { o.price } else { 1000 - o.price };
                let kind = if same {
                    MatchKind::Direct
                } else if buy {
                    MatchKind::Mint
                } else {
                    MatchKind::Burn
                };
                // [043 #2] budget cap (L315-L320)
                if let Some(bud) = budget {
                    let aff = bud
                        .sub(spent)
                        .div(px(e).div(N100_0))
                        .mul(N1E6)
                        .floor()
                        .div(N1E6)
                        .n20_6();
                    if aff <= 0 {
                        cov.budget_stops += 1;
                        return false;
                    }
                    if aff < fill {
                        cov.budget_trims += 1;
                    }
                    fill = fill.min(aff);
                    if fill <= 0 {
                        return false;
                    }
                }
                // v_taker_usd := ROUND(v_fill * v_e / 100.0, 8)
                let taker_usd = n6(fill).mul(px(e)).div(N100_0).round(8);
                if buy {
                    spent = spent.add(taker_usd);
                    cash_delta = cash_delta.sub(taker_usd);
                } else {
                    cash_delta = cash_delta.add(taker_usd);
                }
                fills.push(Fill { maker: oid, maker_user: o.user, price: e, size: fill, kind, taker_usd });
                notional = notional.add(taker_usd);
                filled += fill;
                remaining -= fill;
                true
            });
        }

        // ---- phase 2: taker settlement checks (L465-L516) --------------
        let rest: i128 = if r.otype == OrderType::Limit { remaining } else { 0 };
        let (cash_local, reserve_usd, reserve_loc) = if buy {
            let reserve_usd = n6(rest).mul(limit_c).div(N100_0).round(8);
            let cash_local = cash_delta.neg().div(rate).round(6);
            let reserve_loc = reserve_usd.div(rate).round(6);
            if n6(wallet.available).lt(cash_local.add(reserve_loc)) {
                return Err(EngineError::InsufficientBalance);
            }
            (cash_local, reserve_usd, reserve_loc)
        } else {
            let cash_local = cash_delta.div(rate).round(6);
            // 073: market sells only (limit orders are checked up front).
            if r.otype == OrderType::Market && min_usd.is_pos() && filled > 0 && notional.lt(min_usd) {
                return Err(EngineError::BelowMinSize);
            }
            (cash_local, Num::ZERO, Num::ZERO)
        };

        // ---- phase 3: apply ---------------------------------------------
        if !buy {
            // reserved_shares = reserved_shares + p_size (L238)
            let p = &mut self.positions[pi_taker];
            p.reserved_shares = n6(p.reserved_shares).add(r.size).n20_6();
        }
        let tid = self.alloc_order(Order {
            gen: 0,
            user: r.user,
            book: r.book,
            outcome: r.outcome,
            action: r.action,
            otype: r.otype,
            status: Status::Open,
            price: if r.otype == OrderType::Limit { limit } else { 0 },
            handle: u32::MAX,
            size: size6,
            filled: 0,
            reserved_usd: 0,
            rate,
            expires_at: r.expires_at.unwrap_or(i64::MAX),
        });

        let comp = r.outcome.comp();
        for i in 0..self.fills.len() {
            let f = self.fills[i];
            let ms = Self::slot(f.maker);
            // advance maker order (L323-L327)
            let (mk_user, mk_price, mk_rate, mk_done) = {
                let mo = &mut self.orders[ms];
                mo.filled += f.size;
                mo.status = if mo.filled >= mo.size { Status::Filled } else { Status::PartiallyFilled };
                (mo.user, mo.price, mo.rate, mo.status == Status::Filled)
            };
            if buy {
                if f.kind == MatchKind::Direct {
                    // maker SELL S delivers, receives v_e (L335-L348)
                    let maker_usd = f.taker_usd;
                    let pi = self.pidx(mk_user, r.book, r.outcome);
                    sell_update(&mut self.positions[pi], f.size, f.price, maker_usd);
                    let local = maker_usd.div(mk_rate).round(6);
                    let w = &mut self.wallets[mk_user as usize];
                    w.available = n6(w.available).add(local).n20_6();
                } else {
                    // MINT: maker BUY C spends escrow (L351-L371)
                    let maker_usd = n6(f.size).mul(px(mk_price)).div(N100_0).round(8);
                    let local = maker_usd.div(mk_rate).round(6);
                    let mo = &mut self.orders[ms];
                    mo.reserved_usd = Num::ZERO.greatest(n6(mo.reserved_usd).sub(maker_usd)).n20_6();
                    let w = &mut self.wallets[mk_user as usize];
                    w.reserved = Num::ZERO.greatest(n6(w.reserved).sub(local)).n20_6();
                    let pi = self.pidx(mk_user, r.book, comp);
                    maker_buy_upsert(&mut self.positions[pi], f.size, maker_usd, mk_price);
                }
            } else {
                if f.kind == MatchKind::Direct {
                    // maker BUY S spends escrow, receives S (L380-L400)
                    let maker_usd = n6(f.size).mul(px(mk_price)).div(N100_0).round(8);
                    let local = maker_usd.div(mk_rate).round(6);
                    let mo = &mut self.orders[ms];
                    mo.reserved_usd = Num::ZERO.greatest(n6(mo.reserved_usd).sub(maker_usd)).n20_6();
                    let w = &mut self.wallets[mk_user as usize];
                    w.reserved = Num::ZERO.greatest(n6(w.reserved).sub(local)).n20_6();
                    let pi = self.pidx(mk_user, r.book, r.outcome);
                    maker_buy_upsert(&mut self.positions[pi], f.size, maker_usd, mk_price);
                } else {
                    // BURN (merge): maker SELL C delivers C, receives a (L403-L416)
                    let maker_usd = n6(f.size).mul(px(mk_price)).div(N100_0).round(8);
                    let local = maker_usd.div(mk_rate).round(6);
                    let pi = self.pidx(mk_user, r.book, comp);
                    sell_update(&mut self.positions[pi], f.size, mk_price, maker_usd);
                    let w = &mut self.wallets[mk_user as usize];
                    w.available = n6(w.available).add(local).n20_6();
                }
                // taker delivers S, collects proceeds (L419-L428)
                sell_update(&mut self.positions[pi_taker], f.size, f.price, f.taker_usd);
            }
            if mk_done {
                self.cov.makers_filled += 1;
                self.retire(f.maker);
            }
        }

        // taker settlement (L467-L516)
        if buy {
            let w = &mut self.wallets[u];
            w.available = n6(w.available).sub(cash_local).sub(reserve_loc).n20_6();
            w.reserved = n6(w.reserved).add(reserve_loc).n20_6();
            if filled > 0 {
                let fq = n6(filled);
                let avg = notional.div(fq); // v_avg_price (unconstrained numeric)
                let p = &mut self.positions[pi_taker];
                if !p.exists {
                    *p = Position {
                        exists: true,
                        shares: filled,
                        total_invested_usd: notional.n20_6(),
                        avg_entry_price: avg.round(6).typmod(8, 6).expect("avg overflow").m,
                        current_value_usd: fq.mul(avg).n20_6(),
                        is_active: true,
                        ..Position::default()
                    };
                } else {
                    let ns = n6(p.shares).add(fq);
                    let inv = n6(p.total_invested_usd).add(notional);
                    p.shares = ns.n20_6();
                    p.total_invested_usd = inv.n20_6();
                    p.avg_entry_price = inv.div(ns).typmod(8, 6).expect("avg overflow").m;
                    p.current_value_usd = ns.mul(avg.round(6)).n20_6();
                    p.is_active = true;
                }
            }
        } else {
            let w = &mut self.wallets[u];
            w.available = n6(w.available).add(cash_local).n20_6();
            if rest == 0 {
                let undelivered = r.size.sub(n6(filled));
                if undelivered.is_pos() {
                    self.cov.market_sell_releases += 1;
                    let p = &mut self.positions[pi_taker];
                    if p.exists {
                        p.reserved_shares = Num::ZERO.greatest(n6(p.reserved_shares).sub(undelivered)).n20_6();
                    }
                }
            }
        }

        let status = if rest > 0 {
            if filled > 0 { Status::PartiallyFilled } else { Status::Open }
        } else if filled > 0 {
            Status::Filled
        } else {
            Status::Cancelled
        };
        {
            let o = &mut self.orders[Self::slot(tid)];
            o.filled = filled;
            o.status = status;
            o.reserved_usd = if buy { reserve_usd.n20_6() } else { 0 };
        }
        if self.cfg.rate_limit {
            let h = self.rl_head[u] as usize;
            self.rl_ring[u][h] = self.now;
            self.rl_head[u] = ((h + 1) % RL_N) as u8;
        }
        let n_fills = self.fills.len();
        if status.live() {
            let o = self.orders[Self::slot(tid)];
            let h = self.ladder.insert(r.book, o.book_side(), o.yes_px(), tid);
            self.orders[Self::slot(tid)].handle = h;
            self.open_user[u] += 1;
            self.open_user_market[u * nm + mkt] += 1;
            if o.expires_at != i64::MAX {
                self.expiry.push(Reverse((o.expires_at, tid)));
            }
        } else if !self.cfg.keep_history {
            self.free_order(tid);
        }
        Ok(PlaceResult { order: tid, status, filled, resting: rest, cash_local, notional, n_fills })
    }

    #[inline(always)]
    fn alloc_order(&mut self, mut o: Order) -> OrderId {
        if let Some(s) = self.free_slots.pop() {
            o.gen = self.orders[s as usize].gen.wrapping_add(1);
            self.orders[s as usize] = o;
            ((o.gen as u64) << 32) | s as u64
        } else {
            self.orders.push(o);
            (self.orders.len() - 1) as u64
        }
    }
    #[inline(always)]
    fn free_order(&mut self, id: OrderId) {
        self.free_slots.push(Self::slot(id) as u32);
    }

    /// A resting order just became terminal: leave the ladder, fix counts.
    #[inline(always)]
    fn retire(&mut self, id: OrderId) {
        let o = self.orders[Self::slot(id)];
        self.ladder.remove(o.book, o.book_side(), o.yes_px(), id, o.handle);
        let nm = self.markets.len();
        let mkt = self.books[o.book as usize].market as usize;
        self.open_user[o.user as usize] -= 1;
        self.open_user_market[o.user as usize * nm + mkt] -= 1;
        if !self.cfg.keep_history {
            self.free_order(id);
        }
    }

    /// Release escrow of a live order (clob_cancel_order / clob_expire_orders body).
    fn release(&mut self, id: OrderId, to: Status) -> CancelResult {
        let s = Self::slot(id);
        let o = self.orders[s];
        let rest = o.size - o.filled; // v_rest numeric(20,6)
        let mut res = CancelResult { released_shares: Num::ZERO, released_local: Num::ZERO };
        if o.action == Action::Buy {
            let loc = n6(o.reserved_usd).div(o.rate).round(6);
            let w = &mut self.wallets[o.user as usize];
            w.available = n6(w.available).add(loc).n20_6();
            w.reserved = Num::ZERO.greatest(n6(w.reserved).sub(loc)).n20_6();
            res.released_local = loc;
        } else {
            let pi = self.pidx(o.user, o.book, o.outcome);
            let p = &mut self.positions[pi];
            if p.exists {
                p.reserved_shares = Num::ZERO.greatest(n6(p.reserved_shares).sub(n6(rest))).n20_6();
            }
            res.released_shares = n6(rest);
        }
        {
            let om = &mut self.orders[s];
            om.status = to;
            om.reserved_usd = 0;
        }
        self.retire(id);
        res
    }

    // ---- clob_cancel_order (045) -------------------------------------------

    pub fn cancel_order(&mut self, user: UserId, id: OrderId) -> Result<CancelResult, EngineError> {
        let s = Self::slot(id);
        let Some(o) = self.orders.get(s) else { return Err(EngineError::OrderNotFound) };
        if o.gen != (id >> 32) as u32 {
            // recycled slot: the order existed and is terminal
            return Err(EngineError::NotCancellable);
        }
        if o.user != user {
            return Err(EngineError::NotYourOrder);
        }
        if !o.status.live() {
            return Err(EngineError::NotCancellable);
        }
        Ok(self.release(id, Status::Cancelled))
    }

    // ---- clob_expire_orders (045) ------------------------------------------

    /// Expire live orders with expires_at <= now, earliest first, at most `limit`.
    pub fn expire(&mut self, limit: usize) -> usize {
        let mut n = 0;
        while n < limit {
            let Some(&Reverse((t, id))) = self.expiry.peek() else { break };
            if t > self.now {
                break;
            }
            self.expiry.pop();
            let s = Self::slot(id);
            let o = &self.orders[s];
            if o.gen != (id >> 32) as u32 || !o.status.live() || o.expires_at != t {
                continue; // stale heap entry
            }
            self.release(id, Status::Expired);
            n += 1;
        }
        n
    }

    /// All order slots (for state dumps in keep_history mode).
    pub fn orders(&self) -> &[Order] {
        &self.orders
    }
}

/// UPDATE positions SET ... for a delivering seller (maker direct sell L336,
/// maker burn L405, taker sell L419). `px_deci` is the price the SQL uses in
/// that statement (v_e or v_maker_price), `usd` the payout credited.
#[inline(always)]
fn sell_update(p: &mut Position, fill: i128, px_deci: u16, usd: Num) {
    if !p.exists {
        return; // UPDATE matches no row
    }
    let sh = n6(p.shares);
    let f = n6(fill);
    let avg = n6(p.avg_entry_price);
    // v_e/100.0: exact value, dscale irrelevant here (only multiplied)
    let price = Num::new(px_deci as i128, 3);
    let left = sh.sub(f);
    p.shares = left.n20_6();
    p.total_invested_usd = Num::ZERO.greatest(n6(p.total_invested_usd).sub(f.mul(avg))).n20_6();
    p.reserved_shares = Num::ZERO.greatest(n6(p.reserved_shares).sub(f)).n20_6();
    p.realized_pnl_usd = n6(p.realized_pnl_usd).add(price.sub(avg).mul(f)).n20_6();
    p.total_payout_usd = n6(p.total_payout_usd).add(usd).n20_6();
    p.current_value_usd = Num::ZERO.greatest(left).mul(price).n20_6();
    p.is_active = left.is_pos();
}

/// INSERT ... ON CONFLICT DO UPDATE for a maker that receives shares
/// (mint L356, direct buy L385) at its own price.
#[inline(always)]
fn maker_buy_upsert(p: &mut Position, fill: i128, usd: Num, px_deci: u16) {
    let price = Num::new(px_deci as i128, 3); // v_maker_price/100.0
    let f = n6(fill);
    if !p.exists {
        *p = Position {
            exists: true,
            shares: fill,
            total_invested_usd: usd.n20_6(),
            avg_entry_price: price.round(6).typmod(8, 6).expect("avg overflow").m,
            current_value_usd: f.mul(price).n20_6(),
            is_active: true,
            ..Position::default()
        };
    } else {
        let ns = n6(p.shares).add(f);
        let inv = n6(p.total_invested_usd).add(usd);
        p.shares = ns.n20_6();
        p.total_invested_usd = inv.n20_6();
        p.avg_entry_price = inv.div(ns).typmod(8, 6).expect("avg overflow").m;
        p.current_value_usd = ns.mul(price).n20_6();
        p.is_active = true;
    }
}
