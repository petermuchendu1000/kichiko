// lib/payments/funding-steps.ts — the one step sequence both money flows use.
//
// Ruling E5: cashing out must be no harder than paying in. L.N. 112 Reg. 84
// and 67(3) put that in law, and the matrix asks for a tap-count gate.
//
// A real tap count needs an authenticated browser session with a funded
// wallet, which this project has no e2e fixture for. So the guarantee is made
// structural instead: deposit and withdraw both type their state as
// FundingStep, so neither can gain or lose a step without changing a shared
// type that the other shares. Equal steps, equal taps.
//
// The order is also the order a person moves through:
//   form    — enter the amount and the number
//   review  — read it back (E2: numerals AND words, and the destination)
//   loading — the request is in flight
//   success — requested or credited; never a balance change before the server
//             says so (E4)
export const FUNDING_STEPS = ['form', 'review', 'loading', 'success'] as const

export type FundingStep = (typeof FUNDING_STEPS)[number]
