//! Exact emulation of the subset of PostgreSQL `numeric` arithmetic that the
//! Kichiko CLOB engine uses.
//!
//! A [`Num`] is `m / 10^s` where `s` is PostgreSQL's *display scale* (dscale).
//! Tracking dscale matters because PostgreSQL chooses the result scale of a
//! division from the operands' dscales (`select_div_scale`), and several engine
//! expressions divide and then round again (double rounding).
//!
//! Semantics reproduced (PostgreSQL 17, src/backend/utils/adt/numeric.c):
//! * `+ -`   : exact, dscale = max(s1, s2)
//! * `*`     : exact, dscale = s1 + s2                        (mul_var, rscale = s1+s2)
//! * `/`     : rounded half away from zero at `select_div_scale` digits
//! * ROUND(x,k): half away from zero, dscale = k               (round_var)
//! * FLOOR(x): dscale 0
//! * assignment to numeric(p,s): ROUND(x,s) + overflow check   (apply_typmod)
//!
//! All arithmetic is on i128 / u128 with overflow checks (debug and release):
//! a value that would not fit panics instead of silently diverging.

use core::cmp::Ordering;

pub const fn pow10_table() -> [u128; 39] {
    let mut t = [1u128; 39];
    let mut i = 1;
    while i < 39 {
        t[i] = t[i - 1] * 10;
        i += 1;
    }
    t
}
pub const P10: [u128; 39] = pow10_table();

#[inline(always)]
pub fn p10(n: u32) -> u128 {
    P10[n as usize]
}

/// NUMERIC_MIN_SIG_DIGITS in numeric.c
const MIN_SIG_DIGITS: i32 = 16;
const MAX_DISPLAY_SCALE: i32 = 1000;

#[derive(Clone, Copy, Debug)]
pub struct Num {
    pub m: i128,
    pub s: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Overflow;

impl PartialEq for Num {
    fn eq(&self, o: &Self) -> bool {
        self.cmp_val(*o) == Ordering::Equal
    }
}

impl Num {
    pub const ZERO: Num = Num { m: 0, s: 0 };
    #[inline(always)]
    pub const fn new(m: i128, s: u32) -> Num {
        Num { m, s }
    }
    #[inline(always)]
    pub const fn int(v: i128) -> Num {
        Num { m: v, s: 0 }
    }

    /// Mantissa at a larger-or-equal scale (exact).
    #[inline(always)]
    pub fn up(self, s: u32) -> i128 {
        debug_assert!(s >= self.s);
        if s == self.s {
            self.m
        } else {
            self.m.checked_mul(p10(s - self.s) as i128).expect("numeric overflow (up)")
        }
    }

    #[inline(always)]
    pub fn add(self, o: Num) -> Num {
        let s = self.s.max(o.s);
        Num { m: self.up(s).checked_add(o.up(s)).expect("numeric overflow (add)"), s }
    }
    #[inline(always)]
    pub fn sub(self, o: Num) -> Num {
        let s = self.s.max(o.s);
        Num { m: self.up(s).checked_sub(o.up(s)).expect("numeric overflow (sub)"), s }
    }
    #[inline(always)]
    pub fn neg(self) -> Num {
        Num { m: -self.m, s: self.s }
    }
    #[inline(always)]
    pub fn mul(self, o: Num) -> Num {
        Num { m: self.m.checked_mul(o.m).expect("numeric overflow (mul)"), s: self.s + o.s }
    }

    #[inline(always)]
    pub fn cmp_val(self, o: Num) -> Ordering {
        let s = self.s.max(o.s);
        self.up(s).cmp(&o.up(s))
    }
    #[inline(always)]
    pub fn lt(self, o: Num) -> bool {
        self.cmp_val(o) == Ordering::Less
    }
    #[inline(always)]
    pub fn le(self, o: Num) -> bool {
        self.cmp_val(o) != Ordering::Greater
    }
    #[inline(always)]
    pub fn gt(self, o: Num) -> bool {
        self.cmp_val(o) == Ordering::Greater
    }
    #[inline(always)]
    pub fn is_pos(self) -> bool {
        self.m > 0
    }
    #[inline(always)]
    pub fn is_zero(self) -> bool {
        self.m == 0
    }

    /// LEAST(a, b): PostgreSQL returns the first argument unless a later one is
    /// strictly smaller (value comparison); dscale follows the chosen argument.
    #[inline(always)]
    pub fn least(self, o: Num) -> Num {
        if o.lt(self) { o } else { self }
    }
    /// GREATEST(a, b)
    #[inline(always)]
    pub fn greatest(self, o: Num) -> Num {
        if o.gt(self) { o } else { self }
    }

    /// ROUND(x, k) for k >= 0: half away from zero, result dscale k.
    #[inline(always)]
    pub fn round(self, k: u32) -> Num {
        if k >= self.s {
            return Num { m: self.up(k), s: k };
        }
        Num { m: round_shift(self.m, self.s - k), s: k }
    }

    /// FLOOR(x): dscale 0.
    pub fn floor(self) -> Num {
        if self.s == 0 {
            return self;
        }
        let d = p10(self.s) as i128;
        Num { m: self.m.div_euclid(d), s: 0 }
    }

    /// Assignment / cast to numeric(prec, scale): round half away from zero to
    /// `scale`, then "numeric field overflow" if |x| >= 10^(prec-scale).
    #[inline(always)]
    pub fn typmod(self, prec: u32, scale: u32) -> Result<Num, Overflow> {
        let r = self.round(scale);
        let lim = p10(prec) as u128; // 10^(prec-scale) at scale `scale`
        if r.m.unsigned_abs() >= lim {
            return Err(Overflow);
        }
        Ok(r)
    }
    /// numeric(20,6), which never overflows for the magnitudes in play; an
    /// overflow here is a harness bug, so it panics loudly.
    #[inline(always)]
    pub fn n20_6(self) -> i128 {
        self.typmod(20, 6).expect("numeric(20,6) overflow").m
    }

    /// Division with PostgreSQL's result scale and rounding (numeric_div).
    pub fn div(self, o: Num) -> Num {
        assert!(o.m != 0, "division by zero");
        let rscale = select_div_scale(self, o);
        let neg = (self.m < 0) != (o.m < 0);
        let a = self.m.unsigned_abs();
        let b = o.m.unsigned_abs();
        // quotient scaled by 10^rscale:  a*10^(sb+rscale-sa) / b
        let e = o.s + rscale - self.s; // rscale >= self.s so e >= o.s >= 0
        let q = scaled_div_round(a, b, e);
        let m = q as i128;
        Num { m: if neg { -m } else { m }, s: rscale }
    }

    pub fn to_string(self) -> String {
        let neg = self.m < 0;
        let a = self.m.unsigned_abs();
        let d = p10(self.s);
        let ip = a / d;
        let fp = a % d;
        let mut out = String::new();
        if neg && a != 0 {
            out.push('-');
        }
        out.push_str(&ip.to_string());
        if self.s > 0 {
            out.push('.');
            let f = fp.to_string();
            for _ in f.len()..self.s as usize {
                out.push('0');
            }
            out.push_str(&f);
        }
        out
    }

    /// Parse a decimal literal exactly as PostgreSQL's numeric_in does,
    /// including exponent notation: dscale = digits after the point minus the
    /// exponent, floored at 0 ('1.0E-7' -> 0.00000010, '1.5e3' -> 1500).
    pub fn parse(t: &str) -> Num {
        let t = t.trim();
        let (neg, t) = match t.strip_prefix('-') {
            Some(r) => (true, r),
            None => (false, t.strip_prefix('+').unwrap_or(t)),
        };
        let (mant, exp) = match t.find(['e', 'E']) {
            Some(i) => (&t[..i], t[i + 1..].parse::<i32>().expect("bad exponent")),
            None => (t, 0),
        };
        let (ip, fp) = match mant.find('.') {
            Some(i) => (&mant[..i], &mant[i + 1..]),
            None => (mant, ""),
        };
        let mut m: i128 = 0;
        for c in ip.bytes().chain(fp.bytes()) {
            assert!(c.is_ascii_digit(), "bad numeric literal {t:?}");
            m = m.checked_mul(10).unwrap().checked_add((c - b'0') as i128).unwrap();
        }
        let mut s = fp.len() as i32 - exp;
        if s < 0 {
            m = m.checked_mul(p10((-s) as u32) as i128).expect("numeric literal overflow");
            s = 0;
        }
        Num { m: if neg { -m } else { m }, s: s as u32 }
    }
}

/// floor(log10(m)) for m > 0 (lzcnt + one table compare).
#[inline(always)]
pub fn ilog10(m: u128) -> u32 {
    debug_assert!(m > 0);
    // floor(log10(m)) is floor(log2(m) * log10(2)) or one more
    let bits = 127 - m.leading_zeros();
    let d = (bits * 1233) >> 12;
    if d < 38 && m >= P10[d as usize + 1] { d + 1 } else { d }
}

/// Round `m / 10^k` half away from zero (k >= 1).
#[inline(always)]
pub fn round_shift(m: i128, k: u32) -> i128 {
    if k == 0 {
        return m;
    }
    if k >= 39 {
        return 0;
    }
    if k <= 19 && m.unsigned_abs() <= u64::MAX as u128 {
        // 64-bit hardware division
        let a = m.unsigned_abs() as u64;
        let d = P10[k as usize] as u64;
        let (q, r) = (a / d, a % d);
        let q = if r >= d - r { q + 1 } else { q } as i128;
        return if m < 0 { -q } else { q };
    }
    let d = p10(k) as i128;
    let q = m / d; // truncates toward zero
    let r = m % d;
    if r.unsigned_abs() * 2 >= d as u128 {
        if m < 0 { q - 1 } else { q + 1 }
    } else {
        q
    }
}

/// (weight, first digit) of |value| = m / 10^s in NBASE=10000 digits, as
/// select_div_scale reads them (weight 0 / digit 0 for zero).
#[inline(always)]
fn weight_first(m: u128, s: u32) -> (i32, u32) {
    if m == 0 {
        return (0, 0);
    }
    let nd = ilog10(m) as i32 + 1;
    let d = nd - 1 - s as i32; // decimal exponent of the leading digit
    let w = d.div_euclid(4);
    let shift = s as i32 + 4 * w; // value / 10000^w == m / 10^shift
    let first = if shift < 0 {
        m * p10((-shift) as u32)
    } else if (m >> 64) == 0 {
        (m as u64 / P10[shift as usize] as u64) as u128
    } else {
        m / p10(shift as u32)
    };
    (w, first as u32)
}

/// numeric.c select_div_scale().
#[inline(always)]
pub fn select_div_scale(a: Num, b: Num) -> u32 {
    let (w1, f1) = weight_first(a.m.unsigned_abs(), a.s);
    let (w2, f2) = weight_first(b.m.unsigned_abs(), b.s);
    let mut qweight = w1 - w2;
    if f1 <= f2 {
        qweight -= 1;
    }
    let mut rscale = MIN_SIG_DIGITS - qweight * 4;
    rscale = rscale.max(a.s as i32).max(b.s as i32).max(0);
    rscale = rscale.min(MAX_DISPLAY_SCALE);
    rscale as u32
}

/// round_half_away(a * 10^e / b) with no intermediate overflow: long division
/// in chunks of decimal digits (the remainder is always < b).
#[inline]
fn scaled_div_round(a: u128, b: u128, e: u32) -> u128 {
    // fast path: b is a power of ten (e.g. `/ 100.0`, `/ 1.00000000`)
    if let Some(j) = pow10_exponent(b) {
        if e >= j {
            return a.checked_mul(p10(e - j)).expect("numeric overflow (div)");
        }
        let k = j - e;
        if k >= 39 {
            return 0;
        }
        let d = p10(k);
        let q = a / d;
        let r = a % d;
        return if r >= d - r { q + 1 } else { q };
    }
    // u64 fast path: a*10^e and b both fit in u64
    if b <= u64::MAX as u128 && e <= 19 {
        if let Some(n) = a.checked_mul(p10(e)) {
            if n <= u64::MAX as u128 {
                let (n, b) = (n as u64, b as u64);
                let (q, r) = (n / b, n % b);
                return (if r >= b - r { q + 1 } else { q }) as u128;
            }
        }
    }
    let mut q = a / b;
    let mut r = a % b;
    let mut e = e;
    // largest k with b*10^k < 2^128 (so r*10^k never overflows)
    let kmax = ilog10(u128::MAX / b).min(38);
    assert!(kmax > 0, "divisor too large");
    while e > 0 {
        if r == 0 {
            q = q.checked_mul(p10(e)).expect("numeric overflow (div)");
            break;
        }
        let k = e.min(kmax);
        let t = r * p10(k);
        q = q
            .checked_mul(p10(k))
            .and_then(|x| x.checked_add(t / b))
            .expect("numeric overflow (div)");
        r = t % b;
        e -= k;
    }
    if r >= b - r {
        q += 1;
    }
    q
}

#[inline(always)]
fn pow10_exponent(b: u128) -> Option<u32> {
    if b == 0 {
        return None;
    }
    let l = ilog10(b);
    if P10[l as usize] == b { Some(l) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn n(t: &str) -> Num {
        Num::parse(t)
    }
    #[test]
    fn rounding() {
        assert_eq!(n("2.5").round(0).to_string(), "3");
        assert_eq!(n("-2.5").round(0).to_string(), "-3");
        assert_eq!(n("-2.4999").round(0).to_string(), "-2");
        assert_eq!(n("0.12345650").round(6).to_string(), "0.123457");
        assert_eq!(n("1.5").round(3).to_string(), "1.500");
        assert_eq!(n("-0.7").floor().to_string(), "-1");
    }
    #[test]
    fn parse_exponent() {
        // SELECT '1.0E-7'::numeric -> 0.00000010 ; '1.5e3' -> 1500 ; '25E-1' -> 2.5
        assert_eq!(n("1.0E-7").to_string(), "0.00000010");
        assert_eq!(n("1.5e3").to_string(), "1500");
        assert_eq!(n("25E-1").to_string(), "2.5");
        assert_eq!(n("-0.50").to_string(), "-0.50");
    }
    #[test]
    fn division_scale() {
        // SELECT 1/3 -> 0.33333333333333333333 (20 digits)
        assert_eq!(n("1").div(n("3")).to_string(), "0.33333333333333333333");
        // SELECT 55.5/100.0 -> 0.55500000000000000000
        assert_eq!(n("55.5").div(n("100.0")).to_string(), "0.55500000000000000000");
        // SELECT 10/4 -> 2.5000000000000000
        assert_eq!(n("10").div(n("4")).to_string(), "2.5000000000000000");
        assert_eq!(n("2").div(n("3")).to_string(), "0.66666666666666666667");
        assert_eq!(n("-2").div(n("3")).to_string(), "-0.66666666666666666667");
    }
    #[test]
    fn ilog10_exact() {
        for i in 0..39u32 {
            let p = P10[i as usize];
            assert_eq!(ilog10(p), i);
            if i > 0 { assert_eq!(ilog10(p - 1), i - 1); }
            assert_eq!(ilog10(p + 1), i.max(if p + 1 >= 10 { ilog10(p + 1) } else { 0 }));
        }
        let mut x: u128 = 1;
        for _ in 0..100000 { x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); let v = x >> (x % 127) as u32; if v > 0 { assert_eq!(ilog10(v), v.ilog10()); } }
    }
    #[test]
    fn typmod() {
        assert!(n("999.94").typmod(4, 1).is_ok());
        assert!(n("999.95").typmod(4, 1).is_err());
        assert_eq!(n("-0.00000050").n20_6(), -1);
    }
}
