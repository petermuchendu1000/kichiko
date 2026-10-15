// components/portfolio/transaction-history.tsx
// Recent account activity on the Pip system: custom icons (no emoji), signed
// amounts color-coded by credit/debit, and locale-aware dates.
import { formatDate } from '@/lib/format'
import type { Transaction, TransactionType } from '@/types'
import {
  IconDeposit,
  IconWithdraw,
  IconTrophy,
  IconTrendDown,
  IconRefresh,
  IconCoin,
  IconStar,
  IconPercent,
} from '@/components/ui/icons'

type IconCmp = typeof IconDeposit

const TX_ICON: Partial<Record<TransactionType, IconCmp>> = {
  deposit: IconDeposit,
  withdrawal: IconWithdraw,
  bet_placed: IconCoin,
  bet_won: IconTrophy,
  bet_lost: IconTrendDown,
  bet_refunded: IconRefresh,
  fee: IconPercent,
  bonus: IconStar,
  referral_bonus: IconStar,
  creator_reward: IconStar,
}

const CREDIT_TYPES: ReadonlySet<string> = new Set([
  'deposit',
  'bet_won',
  'bet_refunded',
  'bonus',
  'referral_bonus',
  'creator_reward',
])

interface TransactionHistoryProps {
  transactions: Transaction[]
}

export function TransactionHistory({ transactions }: TransactionHistoryProps) {
  return (
    <div className="card divide-y divide-hairline">
      {transactions.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">No activity yet</p>
      ) : (
        transactions.map((tx) => {
          const Icon = TX_ICON[tx.type] ?? IconCoin
          const isCredit = CREDIT_TYPES.has(tx.type)
          return (
            <div key={tx.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-sm bg-surface-2 text-text-secondary">
                  <Icon size={15} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize text-text-primary">
                    {tx.type.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-text-muted">{formatDate(tx.created_at)}</p>
                  {/* Ruling E3: the provider's own reference — for M-Pesa, the
                      code Safaricom texts the payer. credit_deposit has always
                      written it to payment_reference; nothing ever showed it,
                      so the one identifier people actually reconcile money by
                      lived only in the admin console. Monospaced and
                      selectable, because its job is to be compared against an
                      SMS and quoted to support. */}
                  {tx.payment_reference && (
                    <p className="mt-0.5 select-all font-mono text-xs tracking-tight text-text-muted">
                      {tx.payment_reference}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className={`font-mono text-sm font-medium ${isCredit ? 'text-yes' : 'text-text-secondary'}`}>
                  {isCredit ? '+' : '-'}
                  {tx.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })} {tx.currency}
                </p>
                <p className="text-xs capitalize text-text-muted">{tx.status}</p>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
