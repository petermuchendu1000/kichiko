//! numfuzz <n> <seed>: emit random numeric cases as TSV
//!   id \t SQL expression \t twin result text
//! scripts/numcheck.py evaluates every expression on PostgreSQL (kdb2) and
//! compares the text output (value AND display scale) exactly.
use kengine::Num;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    /// random decimal with `scale` digits after the point and up to `idig`
    /// integer digits; biased toward .5 ties and boundaries
    fn dec(&mut self, idig: u32, scale: u32, signed: bool) -> Num {
        let total = idig + scale;
        let mut m: i128 = 0;
        let nd = 1 + self.below(total as u64) as u32;
        for _ in 0..nd {
            m = m * 10 + self.below(10) as i128;
        }
        if scale > 0 && self.below(4) == 0 {
            // force a trailing 5 (tie at scale-1)
            m = (m / 10) * 10 + 5;
        }
        if signed && self.below(3) == 0 {
            m = -m;
        }
        Num::new(m, scale)
    }
}

fn lit(n: Num) -> String {
    format!("{}::numeric", n.to_string())
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let n: usize = a.get(1).map(|x| x.parse().unwrap()).unwrap_or(10000);
    let mut r = Rng(a.get(2).map(|x| x.parse().unwrap()).unwrap_or(7) | 1);
    for id in 0..n {
        let kind = r.below(11);
        let (expr, twin) = match kind {
            0 => {
                let x = { let sc = r.below(14) as u32; r.dec(8, sc, true) };
                let k = [0u32, 1, 6, 8][r.below(4) as usize];
                (format!("round({}, {})", lit(x), k), x.round(k).to_string())
            }
            1 => {
                let x = { let sc = r.below(14) as u32; r.dec(10, sc, true) };
                (format!("({})::numeric(20,6)", lit(x)), Num::new(x.n20_6(), 6).to_string())
            }
            2 => {
                let x = { let sc = r.below(10) as u32; r.dec(8, sc, true) };
                let mut y = { let sc = r.below(10) as u32; r.dec(6, sc, true) };
                if y.m == 0 { y = Num::new(7, 3); }
                (format!("{} / {}", lit(x), lit(y)), x.div(y).to_string())
            }
            3 => {
                // budget affordability, L316
                let b = { let sc = r.below(3) as u32; r.dec(4, sc, false) };
                let s = Num::new(r.below(b.up(8).max(1) as u64) as i128, 8);
                let e = Num::new(1 + r.below(999) as i128, 1);
                let bs = b.sub(s);
                let v = bs.div(e.div(Num::new(1000, 1))).mul(Num::new(1_000_000, 0)).floor().div(Num::new(1_000_000, 0));
                (format!("floor((({} - {}) / ({}::numeric(4,1) / 100.0)) * 1e6) / 1e6", lit(b), lit(s), e.to_string()), v.to_string())
            }
            4 => {
                // tick lattice, L190-L193
                let p = { let sc = r.below(5) as u32; r.dec(3, sc, true) };
                let ts = if r.below(2) == 0 { Num::new(100, 4) } else { Num::new(10, 4) };
                let t = Num::new(1, 1).greatest(ts.mul(Num::new(100, 0)));
                let v = p.div(t).round(0).mul(t).round(1);
                (format!("round((round({} / greatest(0.1, {}::numeric(6,4) * 100)) * greatest(0.1, {}::numeric(6,4) * 100))::numeric, 1)",
                    lit(p), ts.to_string(), ts.to_string()), v.to_string())
            }
            5 => {
                // avg entry price, L368 -> numeric(8,6)
                let inv = r.dec(4, 6, false);
                let usd = r.dec(3, 8, false);
                let sh = r.dec(4, 6, false);
                let f = Num::new(1 + r.below(100_000_000) as i128, 6);
                let v = inv.add(usd).div(sh.add(f));
                let t = match v.typmod(8, 6) { Ok(x) => x.to_string(), Err(_) => "OVERFLOW".into() };
                (format!("(({} + {}) / ({} + {}))::numeric(8,6)", lit(inv), lit(usd), lit(sh), lit(f)), t)
            }
            6 => {
                // local currency conversion, L346
                let usd = r.dec(4, 8, false);
                let rates = ["1.00000000", "0.00775000", "0.00026700", "0.03850000", "0.00714000"];
                let rt = Num::parse(rates[r.below(5) as usize]);
                (format!("round({} / {}::numeric(20,8), 6)", lit(usd), rt.to_string()), usd.div(rt).round(6).to_string())
            }
            7 => {
                // taker usd, L331: round(fill * e / 100.0, 8)
                let f = Num::new(1 + r.below(10_000_000_000) as i128, 6);
                let e = Num::new(1 + r.below(999) as i128, 1);
                (format!("round({}::numeric(20,6) * {}::numeric(4,1) / 100.0, 8)", f.to_string(), e.to_string()),
                    f.mul(e).div(Num::new(1000, 1)).round(8).to_string())
            }
            8 => {
                // v_avg_price then current_value (L482, L489, L497)
                let notional = r.dec(4, 8, false);
                let f = Num::new(1 + r.below(10_000_000_000) as i128, 6);
                let avg = notional.div(f);
                (format!("(({0} / {1}::numeric(20,6)) * {1}::numeric(20,6))::numeric(20,6)::text || '|' || round({0} / {1}::numeric(20,6), 6)::text",
                    lit(notional), f.to_string()),
                    format!("{}|{}", Num::new(avg.mul(f).n20_6(), 6).to_string(), avg.round(6).to_string()))
            }
            10 => {
                // numeric_in with exponent notation (Python Decimal str() emits it)
                let x = { let sc = r.below(6) as u32; r.dec(4, sc, true) };
                let e = r.below(21) as i32 - 10;
                let lit = format!("{}{}{}", x.to_string(), if r.below(2) == 0 { "E" } else { "e" }, e);
                (format!("'{}'::numeric", lit), Num::parse(&lit).to_string())
            }
            _ => {
                let x = { let sc = r.below(8) as u32; r.dec(6, sc, true) };
                (format!("floor({})", lit(x)), x.floor().to_string())
            }
        };
        println!("{id}\t{expr}\t{twin}");
    }
}
