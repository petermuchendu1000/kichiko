# Kichiko — Key Flows

## 1. Authentication & RBAC (Module 1)

### Sign-up
```
Browser (register page)
  └─ supabase.auth.signUp(email, password, { data: {
        display_name, country_code, preferred_currency, referral_code_used } })
        │
        ▼
auth.users INSERT  ──trigger──▶  public.handle_new_user()  [SECURITY DEFINER]
        │                          • profile: display_name (→full_name→email),
        │                            country_code (UPPER, 2-letter, default KE),
        │                            preferred_currency (validated enum, default KES),
        │                            referred_by (from referral_code_used|referral_code)
        │                          • wallets: KES,UGX,TZS,RWF + preferred currency
        │                          • referrals row + referral_count++ (if referred)
        ▼
Confirmation email (Supabase) ──▶ /auth/callback?code=… ──▶ exchangeCodeForSession
        ▼
Session cookie set · profile + wallets ready
```
Fixed in migration `003_fix_signup_metadata.sql` (the original trigger read
`full_name`/`referral_code` and ignored country/currency).

### Sign-in
`supabase.auth.signInWithPassword` → session cookie → `router.refresh()`.
OAuth (Google) → `/auth/callback` → `exchangeCodeForSession`.

### Session & route protection (edge middleware)
- Every request: `supabase.auth.getUser()` refreshes the session.
- `PROTECTED_ROUTES` (portfolio, settings, /api/orders, /api/payments, market
  writes) → redirect to `/auth/login?next=…` when unauthenticated.
- `ADMIN_ROUTES` (`/admin`) → must be authenticated **and** role ∈ {admin,
  moderator} (DB role check at the edge); otherwise redirect to `/`.
- Security headers set on every response (X-Frame-Options, X-Content-Type-
  Options, Referrer-Policy, Permissions-Policy). CSP deferred to Module 14.

### RBAC model
| Role | Capabilities |
|---|---|
| `user` | trade, deposit/withdraw, comment, create markets (→ pending review) |
| `resolver` | + resolve markets |
| `moderator` | + admin dashboard, market review, KYC review |
| `admin` | full control |

Server-side enforcement is centralized in **`lib/auth.ts`**:
- `getAuthContext()` → `{ user, role, accountStatus, kycStatus, supabase }` | null
- `requireUser()` → 401 if anon, 403 if account not active
- `requireRole(allowed)` → adds role gate (returns a `GuardResult`)
- `hasRole(role, allowed)` → pure predicate (unit-tested)
- Constants: `ADMIN_ROLES`, `RESOLVER_ROLES`

DB-side enforcement: RLS on every table + `is_admin()` (admin|moderator).

### Tested (Module 1)
- DB e2e (rolled back): signup provisions profile (correct display_name /
  country / currency) + wallets; invalid currency→KES; `zm`→`ZM`; Zambia gets a
  ZMW wallet; referral linkage (referred_by + referrals row + count++).
- Unit: `hasRole` matrix; account guards via `requireUser`/`requireRole` shape.

---

## 2. Trading / bet placement (Module 4) — _to be documented_
## 3. Deposit (Module 6) / Withdrawal (Module 7) — _to be documented_
## 4. Market lifecycle & resolution (Module 3/11) — _to be documented_
## 5. Polymarket ingestion (Module 3) — _to be documented_
