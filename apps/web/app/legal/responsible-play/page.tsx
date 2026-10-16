import type { Metadata } from 'next'
import { LegalPage } from '@/components/content/legal-page'
import { TakeABreak } from '@/components/account/take-a-break'
import { PlayLimits } from '@/components/account/play-limits'

export const metadata: Metadata = {
  title: 'Responsible Play',
  description: 'Play within your means and know where to get help.',
}

export default function ResponsiblePlayPage() {
  return (
    <LegalPage title="Responsible Play" updated="July 2026">
      <p>
        Elopis involves real money and real risk. We want trading to stay fun
        and under control. Please read and take these seriously.
      </p>

      <h2>Our principles</h2>
      <ul>
        <li><strong>Adults only.</strong> You must be 18 or older (25 or older in Uganda).</li>
        <li><strong>Only stake what you can afford to lose.</strong> Never stake money you need for essentials.</li>
        <li><strong>No guaranteed income.</strong> Even likely outcomes sometimes don&rsquo;t happen.</li>
        <li><strong>Don&rsquo;t chase losses.</strong> Take breaks; step away when it stops being fun.</li>
      </ul>

      <h2>Take a break</h2>
      <p>
        Stop yourself from opening new positions, straight away. You can still
        sell what you hold and withdraw your money at any time &mdash; a break
        stops play, not payouts.
      </p>
      <p>
        A break cannot be shortened or cancelled once it starts. That is the
        point of it.
      </p>
      <TakeABreak />

      <h2>Your limits</h2>
      <p>
        Cap what you can add, and cap how far down you can go. Lowering a limit
        takes effect the moment you save it. Raising one &mdash; or removing it
        &mdash; takes 24 hours and then has to be confirmed, so the decision is
        never made in the heat of a position.
      </p>
      <PlayLimits />

      <h2>Warning signs</h2>
      <ul>
        <li>Staking more than you planned or can afford.</li>
        <li>Borrowing money to play, or hiding it.</li>
        <li>Feeling anxious, or chasing losses to &ldquo;win it back&rdquo;.</li>
      </ul>

      <h2>Getting help</h2>
      <p>
        If gambling is causing harm to you or someone you know, please reach out
        to a local support organisation. The limits and the break above are
        yours to set without asking anyone, and we will help if you would
        rather talk to a person. You are not alone and help is available.
      </p>

      <h2>See also</h2>
      <p>
        <a href="/legal/terms">Terms of Service</a> ·{' '}
        <a href="/legal/privacy">Privacy Policy</a>
      </p>
    </LegalPage>
  )
}
