#!/usr/bin/env python3
"""
scripts/sim/quant.py — quantitative-finance model library for Kichiko seeding.

Pure, dependency-light (numpy only) generators used by seed_intensive.py to
produce lifelike, internally-consistent simulated market data. Every function
is deterministic given a numpy Generator, so the whole dataset is reproducible.

Models implemented
------------------
* gbm_path                — geometric Brownian motion (spot price, e.g. BTC).
* merton_jump_diffusion   — GBM + compound-Poisson log-normal jumps (news shocks).
* ou_logit_path           — binary implied-probability path in logit space:
                            Ornstein–Uhlenbeck mean-reversion toward a drifting
                            fair value + AR(1) stochastic volatility (vol
                            clustering) + rare Poisson jumps, optionally driven
                            by a shared cross-market latent factor.
* softmax_simplex_paths   — correlated latent OU scores -> softmax; probabilities
                            sum to 1 at EVERY timestamp (a proper simplex).
* market_factor_path      — a shared latent factor (systematic risk) so many
                            markets co-move like a real book on macro days.
* clob_book               — a realistic central-limit-order-book snapshot:
                            geometric depth decay away from the mid, a bid/ask
                            spread, and per-level size noise.
* taker_flow              — a stream of marketable (taker) orders whose signed
                            order-flow is autocorrelated (herding), used to mint
                            realistic fills against the resting book.

All probability outputs are clamped to a display-sane band to avoid 0/1
degeneracy in charts and order books.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

PROB_CLAMP = 0.02          # keep implied probs within [0.02, 0.98]
CENTS_MIN, CENTS_MAX = 0.1, 99.9   # clob_orders price_cents CHECK bounds


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _clampp(p: np.ndarray | float) -> np.ndarray | float:
    return np.clip(p, PROB_CLAMP, 1.0 - PROB_CLAMP)


def logit(p):
    p = _clampp(p)
    return np.log(p / (1.0 - p))


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


# --------------------------------------------------------------------------- #
# spot-price processes (BTC and other numeric underlyings)
# --------------------------------------------------------------------------- #
def gbm_path(s0: float, n: int, mu: float, sigma: float, dt: float,
             rng: np.random.Generator) -> np.ndarray:
    """Geometric Brownian motion: dS = mu*S*dt + sigma*S*dW (exact discretisation)."""
    incr = (mu - 0.5 * sigma ** 2) * dt + sigma * math.sqrt(dt) * rng.standard_normal(n - 1)
    return s0 * np.exp(np.concatenate([[0.0], np.cumsum(incr)]))


def merton_jump_diffusion(s0: float, n: int, mu: float, sigma: float, dt: float,
                          lam: float, jump_mu: float, jump_sigma: float,
                          rng: np.random.Generator) -> np.ndarray:
    """GBM plus a compound-Poisson jump component (Merton 1976) for headline shocks.

    lam = expected jumps per unit time; jump sizes are log-normal(jump_mu, jump_sigma).
    """
    diff = (mu - 0.5 * sigma ** 2) * dt + sigma * math.sqrt(dt) * rng.standard_normal(n - 1)
    n_jumps = rng.poisson(lam * dt, n - 1)
    jumps = np.array([rng.normal(jump_mu, jump_sigma, k).sum() if k else 0.0 for k in n_jumps])
    return s0 * np.exp(np.concatenate([[0.0], np.cumsum(diff + jumps)]))


# --------------------------------------------------------------------------- #
# implied-probability processes (prediction-market prices)
# --------------------------------------------------------------------------- #
def market_factor_path(n: int, rng: np.random.Generator,
                       kappa: float = 0.05, vol: float = 0.04) -> np.ndarray:
    """Mean-reverting shared latent factor; scaled into each market's dynamics."""
    f = np.zeros(n)
    for i in range(1, n):
        f[i] = f[i - 1] + kappa * (0.0 - f[i - 1]) + rng.normal(0, vol)
    return f


def ou_logit_path(p_now: float, n: int, rng: np.random.Generator,
                  factor: np.ndarray | None = None, beta: float = 0.0,
                  kappa: float = 0.045, base_var: float = 0.010) -> np.ndarray:
    """Binary implied-probability path, anchored so path[-1] == p_now.

    OU mean-reversion toward a slow-drifting fair value, AR(1) stochastic
    volatility (clustering), rare Poisson news jumps, and an optional loading
    `beta` on a shared `market_factor_path` for cross-market correlation.
    """
    z = np.zeros(n)
    theta = 0.0            # drifting fair value in logit space
    v = base_var           # stochastic-variance state
    for i in range(1, n):
        theta += rng.normal(0, 0.02)
        v = max(0.002, 0.90 * v + 0.10 * base_var + rng.normal(0, 0.0015))
        shock = rng.normal(0, math.sqrt(v))
        jump = rng.normal(0, 0.30) if rng.random() < 0.03 else 0.0
        sys = beta * (factor[i] - factor[i - 1]) if factor is not None else 0.0
        z[i] = z[i - 1] + kappa * (theta - z[i - 1]) + shock + jump + sys
    z = z - z[-1] + float(logit(p_now))     # anchor endpoint to current price
    return _clampp(sigmoid(z))


def softmax_simplex_paths(prices: list[float], n: int, rng: np.random.Generator,
                          kappa: float = 0.04) -> list[np.ndarray]:
    """Correlated latent OU scores -> softmax simplex, anchored to `prices`."""
    q = np.array([max(1e-4, p) for p in prices], dtype=float)
    q = q / q.sum()
    base = np.log(q)                          # softmax(base) == q
    s = np.tile(base, (n, 1)).astype(float)
    k = len(prices)
    for i in range(1, n):
        mkt = rng.normal(0, 0.03)             # shared regime wobble
        for j in range(k):
            regime = rng.normal(0, 0.6) if rng.random() < 0.02 else 0.0
            s[i, j] = s[i - 1, j] + kappa * (base[j] - s[i - 1, j]) + rng.normal(0, 0.10) + mkt + regime
    s = s - s[-1, :] + base                    # anchor last step to q
    ex = np.exp(s - s.max(axis=1, keepdims=True))
    probs = ex / ex.sum(axis=1, keepdims=True)
    return [probs[:, j] for j in range(k)]


# --------------------------------------------------------------------------- #
# central-limit-order-book microstructure
# --------------------------------------------------------------------------- #
@dataclass
class BookLevel:
    side: str          # 'yes' or 'no'  (outcome_side)
    action: str        # 'buy' (bid) or 'sell' (ask)
    price_cents: float
    size: float


def clob_book(mid_cents: float, rng: np.random.Generator, depth: int = 8,
              half_spread: float = 0.6, tick: float = 0.1,
              top_size: float = 4000.0, decay: float = 0.72) -> list[BookLevel]:
    """A resting order book around `mid_cents` (price of YES, in cents 0.1-99.9).

    Returns YES bids/asks laddered away from the mid with geometric size decay.
    A NO buy at price c is economically a YES sell at (100-c); we emit genuine
    YES-side buy (bid) and sell (ask) ladders — matching the CLOB schema where a
    single outcome token trades two-sided.
    """
    mid = min(CENTS_MAX - depth * tick, max(CENTS_MIN + depth * tick, mid_cents))
    levels: list[BookLevel] = []
    for i in range(depth):
        off = half_spread + i * tick
        size = top_size * (decay ** i) * rng.uniform(0.6, 1.4)
        bid = round(max(CENTS_MIN, mid - off), 1)
        ask = round(min(CENTS_MAX, mid + off), 1)
        levels.append(BookLevel("yes", "buy", bid, round(size, 2)))
        levels.append(BookLevel("yes", "sell", ask, round(size * rng.uniform(0.8, 1.2), 2)))
    return levels


def taker_flow(n: int, rng: np.random.Generator, rho: float = 0.35) -> np.ndarray:
    """Autocorrelated signed order-flow in {-1,+1} (herding/momentum in trades)."""
    out = np.empty(n, dtype=int)
    s = 1 if rng.random() < 0.5 else -1
    for i in range(n):
        if rng.random() < (1 - rho):
            s = 1 if rng.random() < 0.5 else -1
        out[i] = s
    return out
