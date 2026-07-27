# How betting & pricing works

> A plain-language explanation of prices, shares, payouts, and the order-book
> engine behind Kichiko.

## Shares, prices, and payouts

Every market has two sides: **YES** and **NO**. You buy shares of the side you
believe in.

- A share's **price** is shown as a percentage, e.g. `62%`. That's the market's
  current estimate that the outcome happens.
- **YES price + NO price always add up to 100%.**
- If the market resolves in your favour, **each of your winning shares is worth
  1 unit** (100%). If it resolves against you, your shares are worth **0**.

**Example.** You spend KES 620 on YES at a price of 62%. That buys you ~1,000
YES shares. If YES wins, you receive ~KES 1,000 — a profit of ~KES 380. If NO
wins, you receive nothing.

The lower the price when you buy, the bigger your potential payout per unit
staked — because you're betting on the less-expected outcome.

## Why prices move (the order book)

Kichiko runs an **order book**: your order is matched against other traders'
orders, and the price is set by where buyers and sellers actually meet. Orders
match by **price-time priority** — the best price fills first, and ties go to
whoever was there first.

What you need to know as a trader:

- **Buying YES pushes the YES price up** (and NO down); buying NO does the
  opposite. Big orders move the price more than small ones.
- You can place a **market order** (fill right now at the best available prices)
  or a **limit order** (rest on the book at a price you choose until someone
  trades with you).
- Prices reflect **all the buying and selling so far** — think of the price as a
  live crowd estimate that updates with every trade.
- Because a large order eats into the book as it fills, you pay a slightly higher
  average price on bigger orders. The confirmation screen always shows the **shares
  you'll receive and the payout if you win** before you commit — check it.

You never pay more than your stake, and you can never lose more than you put in.

## Placing a bet

1. Open a market and read the question and resolution criteria.
2. Choose **YES** or **NO**.
3. Enter your **stake** in your currency. The panel shows shares and potential
   payout in real time.
4. Confirm. The bet is placed atomically — your balance is debited and your
   position created in a single step, so what you see is what you get.

## When a market closes and resolves

- **Closes:** at the market's closing time, no more bets are accepted.
- **Resolves:** once the real outcome is known and verified, the market is
  settled. Winning shares are paid out to your balance automatically — you don't
  need to claim anything.
- If a market is **cancelled** (e.g. the question became invalid), stakes are
  returned.

See your live positions and payouts in [Portfolio & P&L](./portfolio-and-pnl.md).
