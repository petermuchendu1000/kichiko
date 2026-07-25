import type { Metadata } from 'next'
import { LegalPage } from '@/components/content/legal-page'

export const metadata: Metadata = {
  title: 'Responsible Play',
  description: 'Play within your means and know where to get help.',
}

export default function ResponsiblePlayPage() {
  return (
    <LegalPage title="Responsible Play" updated="July 2026">
      <p>
        MarketPips involves real money and real risk. We want trading to stay fun
        and under control. Please read and take these seriously.
      </p>

      <h2>Our principles</h2>
      <ul>
        <li><strong>18+ only.</strong> You must be of legal age in your country.</li>
        <li><strong>Only stake what you can afford to lose.</strong> Never stake money you need for essentials.</li>
        <li><strong>No guaranteed income.</strong> Even likely outcomes sometimes don&rsquo;t happen.</li>
        <li><strong>Don&rsquo;t chase losses.</strong> Take breaks; step away when it stops being fun.</li>
      </ul>

      <h2>Tools we offer</h2>
      <p>
        You can request limits or a cooling-off / self-exclusion period on your
        account. Contact us via the <a href="/help">Help</a> page and we&rsquo;ll
        set it up.
      </p>

      <h2>Warning signs</h2>
      <ul>
        <li>Staking more than you planned or can afford.</li>
        <li>Borrowing money to play, or hiding it.</li>
        <li>Feeling anxious, or chasing losses to &ldquo;win it back&rdquo;.</li>
      </ul>

      <h2>Getting help</h2>
      <p>
        If gambling is causing harm to you or someone you know, please reach out
        to a local support organisation, and contact us to apply account limits.
        You are not alone and help is available.
      </p>

      <h2>See also</h2>
      <p>
        <a href="/legal/terms">Terms of Service</a> ·{' '}
        <a href="/legal/privacy">Privacy Policy</a>
      </p>
    </LegalPage>
  )
}
