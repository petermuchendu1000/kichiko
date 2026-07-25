// lib/markets/faq.ts
// Server-safe FAQ builder shared by the market page (server component, for the
// FAQPage JSON-LD) and the MarketFaq client accordion. Kept in a plain module
// (no 'use client') so the server can call it directly — a client-module export
// cannot be invoked from the server.

export type FaqItem = { q: string; a: string }

/** Build the market's FAQ from its own data. Pure — safe on server or client. */
export function buildMarketFaq(input: {
  title: string
  isMulti: boolean
  outcomeCount: number
  closesLabel: string
  feePct: string
}): FaqItem[] {
  const { title, isMulti, outcomeCount, closesLabel, feePct } = input
  return [
    {
      q: `What does "${title}" mean?`,
      a: isMulti
        ? `This is a multiple-choice prediction with ${outcomeCount} possible outcomes. Each outcome trades as its own chance between 0% and 100%; you buy shares in the outcome you believe is most likely.`
        : `This is a Yes/No prediction. The price of Yes shows the market's estimated chance of it happening. A price of 65 means about a 65% chance. Buying Yes wins if it happens; buying No wins if it does not.`,
    },
    {
      q: 'How do I make a prediction on MarketPips?',
      a: 'Pick an outcome, enter how much you want to stake, and confirm. Your order is matched with other people on the order book at the current price. Add money to your wallet with M-Pesa.',
    },
    {
      q: 'When and how is this event decided?',
      a: `Trading closes on ${closesLabel}. After the result is known, the event is decided using the source listed in the Rules tab. Winning shares pay out in full; losing shares pay nothing.`,
    },
    {
      q: 'What fees does MarketPips charge?',
      a: `A ${feePct} platform fee is charged per trade, and a small part is shared with the person who created the event. There are no hidden spreads: the price you see is the price you pay.`,
    },
    {
      q: 'Can I sell before the event is decided?',
      a: 'Yes. You can sell any time while the event is open. Sell some or all of your shares at the current price to take profit or cut a loss before the result.',
    },
  ]
}
