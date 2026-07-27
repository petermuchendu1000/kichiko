import type { Metadata } from 'next'
import { LegalPage } from '@/components/content/legal-page'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms governing your use of Kichiko.',
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="July 2026">
      <p>
        These Terms govern your access to and use of Kichiko (the
        &ldquo;Platform&rdquo;). By creating an account or making a prediction you
        agree to these Terms. <strong>This is a launch template pending final
        review by legal counsel for each East-African jurisdiction we operate
        in.</strong>
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old (or the legal age in your country) and
        legally permitted to use prediction markets where you live. You are
        responsible for complying with your local laws.
      </p>

      <h2>2. Accounts</h2>
      <p>
        Keep your credentials secure and your details accurate. You are
        responsible for activity on your account. We may require identity
        verification (KYC) and may suspend accounts for suspected fraud, abuse,
        or regulatory reasons.
      </p>

      <h2>3. Trading &amp; risk</h2>
      <ul>
        <li>Predictions involve real money and a real risk of loss.</li>
        <li>
          Prices are set by a central limit order book: your orders are matched
          against other participants&rsquo; orders by price-time priority, and
          markets resolve to the real, verified outcome.
        </li>
        <li>All predictions are final once confirmed, until the event is decided.</li>
      </ul>

      <h2>4. Deposits, withdrawals &amp; fees</h2>
      <p>
        Deposits and withdrawals are processed via third-party mobile-money
        providers. Applicable platform and provider fees are shown before you
        confirm. Withdrawals may be subject to KYC and limits.
      </p>

      <h2>5. Prohibited conduct</h2>
      <p>
        No market manipulation, fraud, money laundering, use of the Platform
        where prohibited, or attempts to disrupt or gain unauthorised access.
      </p>

      <h2>6. Resolution &amp; disputes</h2>
      <p>
        Markets resolve according to their stated criteria. Disputes are handled
        through our moderation and resolution process; our resolution decisions
        are final absent manifest error.
      </p>

      <h2>7. Liability</h2>
      <p>
        The Platform is provided &ldquo;as is&rdquo;. To the extent permitted by
        law, we are not liable for indirect or consequential losses. Nothing
        limits liability that cannot be limited by law.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update these Terms; material changes will be notified. Continued
        use after changes constitutes acceptance.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions? See the <a href="/help">Help</a> page. Related policies:{' '}
        <a href="/legal/privacy">Privacy</a> and{' '}
        <a href="/legal/responsible-play">Responsible play</a>.
      </p>
    </LegalPage>
  )
}
