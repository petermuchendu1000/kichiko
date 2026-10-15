// components/content/legal-page.tsx — shared layout for legal/help prose pages.
// Renders inside the root <main> landmark (do NOT add another <main>). Uses
// logical spacing + readable measure; accessible headings come from the caller.
import type { ReactNode } from 'react'

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated?: string
  children: ReactNode
}) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
        {title}
      </h1>
      {updated ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Last updated: {updated}</p>
      ) : null}
      {/* The link styling is scoped with :not(.btn). It used to hit EVERY
          descendant <a>, including the ones that are buttons: on /help, the
          "See the events" primary button rendered green-700 text on the blue
          primary fill — 1.19:1, measured by axe, which is an invisible label
          on a live page — and underlined, which also made it look broken.
          `not-prose` does not help: the typography plugin is not installed, so
          that class styles nothing here. */}
      <div className="mt-8 space-y-6 text-[15px] leading-7 text-gray-700 dark:text-gray-300 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900 dark:[&_h2]:text-gray-100 [&_a:not(.btn)]:text-green-700 dark:[&_a:not(.btn)]:text-green-400 [&_a:not(.btn)]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_li]:marker:text-gray-400">
        {children}
      </div>
    </article>
  )
}
