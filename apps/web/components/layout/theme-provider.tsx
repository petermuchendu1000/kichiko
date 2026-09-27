'use client'

// theme-provider.tsx
// ------------------------------------------------------------
// Client theme controller (next-themes) driving the `class` strategy in
// tailwind.config.ts + the :root / .dark token sets in globals.css.
//
//   • attribute="class"      → toggles `dark` on <html> (matches Tailwind).
//   • defaultTheme="system"  → follows the phone's light/dark setting until the
//                              user picks one, which then persists. (Was forced
//                              "dark": in sunlight dark-mode greys lose more
//                              contrast than light ones; work plan v2 A7.)
//   • enableSystem           → required for "system".
//   • disableTransitionOnChange → no color-token cross-fade flicker on toggle.
//
// The inline script next-themes injects sets the class before paint, so there
// is no light/dark flash on load (paired with suppressHydrationWarning on
// <html> in app/layout.tsx).
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      themes={['light', 'dark']}
    >
      {children}
    </NextThemesProvider>
  )
}
