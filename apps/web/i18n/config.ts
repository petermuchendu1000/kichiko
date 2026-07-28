// apps/web/i18n/config.ts — locale registry (Module 17.3/17.4).
// Cookie/profile-based locale selection (no URL segment) so we avoid an
// app/[locale] restructure. Only locales with a shipped message catalog under
// ./messages are selectable — `en` is complete and `sw` is translated. `fr`
// and `am` were previously advertised but had NO catalog (fr.json/am.json are
// missing), so selecting them silently fell back to English; they are removed
// until real catalogs land (F-02/F-03). `en-XA` is a dev/pseudo locale and is
// intentionally excluded from this list.
export const LOCALES = ['en', 'sw'] as const
export type AppLocale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'en'

// Cookie the middleware/UI set when a user switches locale; also mirrors
// profiles.preferred_locale (migration 018) for signed-in users.
export const LOCALE_COOKIE = 'NEXT_LOCALE'

export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: 'English',
  sw: 'Kiswahili',
}

// Default IANA timezone per locale for date/time formatting (East Africa).
export const LOCALE_TIMEZONE: Record<AppLocale, string> = {
  en: 'Africa/Nairobi',
  sw: 'Africa/Nairobi',
}

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return !!value && (LOCALES as readonly string[]).includes(value)
}

export function resolveLocale(value: string | undefined | null): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_LOCALE
}
