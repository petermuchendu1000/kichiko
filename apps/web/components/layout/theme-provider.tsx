'use client'

// theme-provider.tsx
// ------------------------------------------------------------
// Client theme controller (next-themes) driving the `class` strategy in
// tailwind.config.ts + the :root / .dark token sets in globals.css.
//
//   • attribute="class"      → toggles `dark` on <html> (matches Tailwind).
//   • defaultTheme="light"   → LIGHT IS THE DEFAULT, for everyone, until the
//                              user picks otherwise. It previously followed the
//                              device ("system"), which meant the large share of
//                              phones set to dark saw Elopis dark on first open
//                              and never saw the design as drawn.
//                              This also finishes what work plan v2 A7 started
//                              when it moved off a forced "dark": in direct
//                              sunlight — how this is read across East Africa —
//                              dark greys lose more contrast than light ones.
//                              Defaulting to light is that reasoning carried to
//                              its conclusion rather than left to the device.
//   • enableSystem={false}   → the navbar toggle is a plain light⇄dark flip and
//                              never offers "system", so leaving it on would
//                              only reintroduce the device as a hidden input to
//                              the default. A visitor's first paint should not
//                              depend on a setting they cannot see here.
//                              Anyone who prefers dark taps once and it persists.
//   • disableTransitionOnChange → no color-token cross-fade flicker on toggle.
//
// Safe because the theme is entirely class-driven: globals.css carries NO
// `prefers-color-scheme` media query (checked), `:root` is the light token set
// with `color-scheme: light`, and `.dark` is the only dark path. Tailwind is
// `darkMode: 'class'`.
//
// The inline script next-themes injects sets the class before paint, so there
// is no light/dark flash on load (paired with suppressHydrationWarning on
// <html> in app/layout.tsx).
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      themes={['light', 'dark']}
    >
      {children}
    </NextThemesProvider>
  )
}
