import type { Metadata } from 'next'
import { LegalPage } from '@/components/content/legal-page'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Kichiko collects, uses, and protects your data.',
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 2026">
      <p>
        This policy explains what personal data Kichiko collects, why, and your
        rights over it. <strong>This is a launch template pending final review by
        legal counsel and alignment with applicable East-African data-protection
        laws (e.g. Kenya&rsquo;s Data Protection Act, 2019).</strong>
      </p>

      <h2>Data we collect</h2>
      <ul>
        <li><strong>Account:</strong> email, phone, country, preferred currency &amp; language.</li>
        <li><strong>KYC:</strong> identity documents and details, where required.</li>
        <li><strong>Financial:</strong> deposits, withdrawals, predictions, balances.</li>
        <li><strong>Technical:</strong> device/usage data, cookies, and performance telemetry.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To operate your account, process payments, and settle predictions.</li>
        <li>To verify identity and meet legal / anti-money-laundering obligations.</li>
        <li>To secure the Platform, prevent fraud, and improve performance.</li>
        <li>To send you service and (with consent) marketing communications.</li>
      </ul>

      <h2>Legal bases</h2>
      <p>
        We process data to perform our contract with you, to comply with legal
        obligations, for our legitimate interests (security, fraud prevention),
        and with your consent where required.
      </p>

      <h2>Sharing</h2>
      <p>
        We share data with payment providers, KYC/identity and fraud-prevention
        services, infrastructure providers, and authorities where legally
        required. We do not sell your personal data.
      </p>

      <h2>Retention</h2>
      <p>
        We keep data only as long as needed for the purposes above and to meet
        legal/financial record-keeping requirements, then delete or anonymise it.
        See the retention schedule in our data-retention policy.
      </p>

      <h2>Your rights</h2>
      <p>
        Subject to law, you may request access, correction, deletion, or a copy
        of your data, and object to certain processing. To exercise these rights,
        contact us via the <a href="/help">Help</a> page; we handle data-subject
        requests through a documented process and respond within statutory
        timeframes.
      </p>

      <h2>Cookies</h2>
      <p>
        We use essential cookies (e.g. session, security, and your language
        choice) and limited analytics/performance cookies. You can control
        non-essential cookies via your browser.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit and at rest, access is restricted and
        audited, and we follow the security controls described in our engineering
        documentation.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions or requests, see <a href="/help">Help</a>.
      </p>
    </LegalPage>
  )
}
