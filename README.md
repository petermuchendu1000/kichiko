# 🎯 Kichiko

**East Africa's Premier Prediction Market Platform**

Kichiko lets users trade on real-world outcomes — elections, sports, economics, crypto, and more — paying with **M-Pesa, MTN MoMo, Airtel Money, and PesaPal**.

Built specifically for East Africa:
- 🇰🇪 Kenya (KES · M-Pesa · Airtel Money)
- 🇺🇬 Uganda (UGX · MTN MoMo · Airtel Money)
- 🇹🇿 Tanzania (TZS · Airtel Money · M-Pesa)
- 🇷🇼 Rwanda (RWF · MTN MoMo)
- 🇿🇲 Zambia (ZMW · Airtel Money · MTN MoMo)
- 🇪🇹 Ethiopia (ETB · PesaPal)
- 🇧🇮 Burundi (BIF · PesaPal)

---

## 📐 Architecture

```
kichiko/
├── apps/
│   └── web/                        # Next.js 14 App Router (TypeScript)
│       ├── app/
│       │   ├── page.tsx            # Home — featured + trending markets
│       │   ├── markets/            # Market list, detail, create
│       │   ├── portfolio/          # User portfolio + history
│       │   ├── profile/            # User profile editor
│       │   ├── notifications/      # In-app notifications
│       │   ├── leaderboard/        # Top traders leaderboard
│       │   ├── search/             # Full-text market search
│       │   ├── kyc/                # Identity verification upload
│       │   ├── admin/              # Admin control plane (spec: docs/08-ADMIN.md)
│       │   └── api/
│       │       ├── orders/         # Place bets (LMSR pricing)
│       │       ├── markets/        # CRUD markets + resolve
│       │       ├── payments/
│       │       │   ├── deposit/    # Initiate mobile money deposit
│       │       │   └── withdraw/   # Process withdrawals (B2C)
│       │       ├── search/         # Full-text search API
│       │       └── webhooks/
│       │           ├── mpesa/      # Safaricom STK push callback
│       │           ├── mtn-momo/   # MTN MoMo callback
│       │           └── airtel/     # Airtel Money callback
│       ├── components/
│       │   ├── markets/            # MarketCard, PriceChart, BettingPanel, etc.
│       │   ├── payments/           # DepositModal, WithdrawModal
│       │   └── layout/             # Navbar, HeroSection, StatsBar
│       ├── lib/
│       │   ├── payments/           # M-Pesa, MTN MoMo, Airtel, + B2C withdrawals
│       │   ├── notifications/      # SMS (Africa's Talking) + Email (Resend)
│       │   └── supabase/           # Supabase clients (browser + server)
│       └── hooks/                  # useAuth, useWallets
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql  # Full schema + RLS + LMSR functions
│   │   └── 002_search_leaderboard_kyc.sql  # Search, leaderboard, KYC
│   ├── functions/
│   │   ├── resolve-market/         # Admin market resolution
│   │   ├── update-exchange-rates/  # Auto-update FX rates (cron)
│   │   ├── close-markets/          # Auto-close expired markets (cron)
│   │   └── send-notifications/     # Dispatch SMS + email (cron)
│   └── seed/seed.sql               # East Africa sample markets
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ci.yml
```

---

## 🧠 Pricing Model (LMSR)

Uses a **Logarithmic Market Scoring Rule (LMSR)** automated market maker:

```
yes_price = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))
```

| Concept | Explanation |
|---------|-------------|
| **Shares** | Each bet buys YES or NO shares; 1 share pays $1 if correct |
| **Price** | Current probability of YES (0–100%) |
| **b parameter** | Liquidity sensitivity; auto-derived from pool size |
| **Platform fee** | 2% per bet; 0.25% goes to market creator |

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/yourorg/kichiko.git
cd kichiko/apps/web
npm install
```

### 2. Set up Supabase

```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase
supabase start

# Run migrations
supabase db push

# (Optional) Seed sample markets
supabase db seed
```

Or use the hosted Supabase dashboard:
1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Run `supabase/migrations/001_initial_schema.sql` in SQL Editor
3. Run `supabase/migrations/002_search_leaderboard_kyc.sql`
4. Run `supabase/seed/seed.sql`

### 3. Configure Environment

```bash
cp .env.example .env.local
# Fill in all required variables
```

**Required:**
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- At least one payment provider (M-Pesa or MTN MoMo or Airtel)

**Optional but recommended:**
- `RESEND_API_KEY` — transactional emails
- `AFRICASTALKING_API_KEY` — SMS notifications
- `OPEN_EXCHANGE_RATES_APP_ID` — live FX rates

### 4. Run

```bash
npm run dev
# Open http://localhost:3000
```

### 5. Create Admin User

```bash
# After signing up via the app:
supabase sql "UPDATE public.profiles SET role = 'admin' WHERE id = (SELECT id FROM auth.users WHERE email = 'your@email.com')"
```

---

## 💳 Payment Providers Setup

### M-Pesa (Kenya/Tanzania)
1. Register at [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Create app → get Consumer Key + Secret
3. Apply for Lipa na M-Pesa Online (STK Push) + B2C access
4. Set callback URLs in `.env.local`

### MTN MoMo (Uganda/Rwanda)
1. Register at [momodeveloper.mtn.com](https://momodeveloper.mtn.com)
2. Subscribe to **Collection** + **Disbursement** products
3. Get subscription key, create API user/key

### Airtel Money (Tanzania/Uganda/Kenya/Rwanda/Zambia)
1. Register at [developers.airtel.africa](https://developers.airtel.africa)
2. Create app → get Client ID + Secret

### PesaPal (Multi-country)
1. Register at [developer.pesapal.com](https://developer.pesapal.com)
2. Get Consumer Key + Secret

---

## 🔔 Notifications

### SMS (Africa's Talking)
Africa's Talking covers Kenya, Uganda, Tanzania, Rwanda, and more.
```env
AFRICASTALKING_USERNAME=your-username
AFRICASTALKING_API_KEY=your-api-key
AFRICASTALKING_SENDER_ID=Kichiko
```

### Email (Resend)
```env
RESEND_API_KEY=re_your-key
RESEND_FROM_EMAIL=Kichiko <noreply@kichiko.co.ke>
```

---

## 🗄️ Database Schema

| Table | Purpose |
|-------|---------|
| `profiles` | User accounts + stats |
| `wallets` | Multi-currency wallets (KES, UGX, TZS, RWF, ZMW) |
| `markets` | Prediction markets with LMSR pricing |
| `price_history` | Time-series for charts |
| `orders` | Individual bet records |
| `positions` | Aggregated holdings per user per market |
| `transactions` | All money movements (audit trail) |
| `deposits` | Mobile money deposit requests |
| `withdrawals` | Withdrawal requests + B2C status |
| `exchange_rates` | Local currency → USD rates (auto-updated) |
| `comments` | Market discussion |
| `notifications` | In-app + SMS + Email trigger queue |
| `kyc_documents` | Identity verification documents |
| `referrals` | Referral tracking |
| `market_activity` | Live activity feed |
| `audit_log` | Admin action log |
| `leaderboard` | Materialized view of top traders |

---

## 🔒 Security

- **RLS**: every table has row-level security policies
- **Atomic bets**: `place_bet()` is a single Postgres transaction
- **Idempotency keys**: all payments are idempotent
- **Auth middleware**: protected routes validated at the edge
- **KYC gate**: withdrawals over $100 require verified identity
- **Input validation**: Zod on all API inputs
- **Encrypted storage**: KYC documents in private Supabase storage bucket

---

## ⚙️ Supabase Edge Functions (Cron)

| Function | Schedule | Purpose |
|----------|----------|---------|
| `update-exchange-rates` | Every 6h | Fetch live FX rates |
| `close-markets` | Every 5min | Auto-close expired markets |
| `send-notifications` | Every 2min | Dispatch pending SMS/email |
| `resolve-market` | On demand | Admin market resolution |

---

## 🚢 Deployment

### Vercel (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set env vars
vercel env add NEXT_PUBLIC_SUPABASE_URL
# ... add all from .env.example
```

### Docker / VPS
```bash
cp apps/web/.env.example .env
nano .env  # fill in values
docker compose build
docker compose up -d
```

### Railway
Connect GitHub repo → Railway auto-detects Dockerfile.

---

## 💰 Business Model

| Source | Rate | Notes |
|--------|------|-------|
| Platform fee on bets | 2.0% | Deducted per bet |
| Creator reward | 0.25% | Paid to market creator |
| Withdrawal fee | 1.0% | Mobile money, 0.5% bank |
| Net platform revenue | ~1.75% | Of betting volume |

$100K/month volume → ~$1,750/month platform revenue.

---

## 🗺️ Roadmap

### v1.0 ✅ (Complete)
- [x] Binary prediction markets (YES/NO)
- [x] LMSR automated market maker
- [x] M-Pesa deposits (Kenya/Tanzania)
- [x] MTN MoMo deposits (Uganda/Rwanda)
- [x] Airtel Money deposits (multi-country)
- [x] Multi-currency wallets
- [x] Market creation + admin review
- [x] Admin resolution interface
- [x] Referral system
- [x] Price charts
- [x] Responsive mobile UI

### v1.1 ✅ (Complete)
- [x] Withdrawal flow (M-Pesa B2C, MTN MoMo Disbursement, Airtel B2C)
- [x] Full-text market search
- [x] Profile page
- [x] Notifications page (in-app + SMS + email)
- [x] KYC document upload
- [x] Exchange rate cron (auto-updated every 6h)
- [x] Leaderboard page
- [x] Africa's Talking SMS integration
- [x] Resend email integration

### v2.0 (Planned)
- [ ] Comprehensive admin control plane ([spec: docs/08-ADMIN.md](docs/08-ADMIN.md)) — full user/creator/marketer management, DB-backed payment gateway settings (paybill & keys editable from the UI), finance console, system settings, moderation & audit
- [ ] Multiple choice markets (3+ outcomes)
- [ ] KYC admin review dashboard
- [ ] Mobile app (React Native / Expo)
- [ ] Tanzania USSD interface for feature phones
- [ ] Social features (follow traders, copy portfolio)
- [ ] Automated resolution oracles (Chainlink)
- [ ] Limit orders (order book)
- [ ] PesaPal USSD for Ethiopia

---

## 📚 Documentation

| Doc | Description |
|---|---|
| [`docs/00-ASSESSMENT.md`](docs/00-ASSESSMENT.md) | Initial assessment |
| [`docs/01-ARCHITECTURE.md`](docs/01-ARCHITECTURE.md) | System architecture, stack, trust boundaries |
| [`docs/03-ROADMAP.md`](docs/03-ROADMAP.md) | Module-by-module build roadmap |
| [`docs/04-FLOWS.md`](docs/04-FLOWS.md) | Core user & payment flows |
| [`docs/05-CURRENCY.md`](docs/05-CURRENCY.md) | Multi-currency & FX model |
| [`docs/06-MARKETS.md`](docs/06-MARKETS.md) | Markets & LMSR lifecycle |
| [`docs/07-TRADING.md`](docs/07-TRADING.md) | Orders, positions & fee economics |
| [`docs/08-ADMIN.md`](docs/08-ADMIN.md) | **Admin control plane** — users, creators, marketers, payment gateway settings, finance, system settings, moderation & audit |

---

## 📄 Legal Notice

Kichiko is a prediction market platform. Users must:
- Be 18+ years old
- Comply with local laws regarding prediction markets/betting
- Understand that prediction markets involve financial risk

Operators must review and comply with gambling/prediction market regulations in each jurisdiction before deploying.

---

## 📞 Support

- Email: support@kichiko.co.ke
- Website: kichiko.co.ke
- GitHub Issues: github.com/yourorg/kichiko/issues

---

*Built with ❤️ for East Africa*
