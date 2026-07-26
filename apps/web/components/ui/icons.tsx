// Hand-crafted SVG icon system — zero external icon libraries
// Every icon is purpose-built for Kichiko

import React from 'react'

interface IconProps {
  size?: number
  className?: string
  strokeWidth?: number
  style?: React.CSSProperties
}

const icon = (path: React.ReactNode, viewBox = '0 0 24 24') =>
  function Icon({ size = 16, className = '', strokeWidth = 1.75, style }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={style}
        aria-hidden="true"
      >
        {path}
      </svg>
    )
  }

// Navigation
export const IconHome = icon(<><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></>)
export const IconMarkets = icon(<><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 9h20M9 21V9"/></>)
export const IconSearch = icon(<><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></>)
export const IconBell = icon(<><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>)
export const IconUser = icon(<><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></>)
export const IconMenu = icon(<><path d="M3 6h18M3 12h18M3 18h18"/></>)
export const IconX = icon(<><path d="M18 6L6 18M6 6l12 12"/></>)
export const IconChevronDown = icon(<><path d="M6 9l6 6 6-6"/></>)
export const IconChevronRight = icon(<><path d="M9 6l6 6-6 6"/></>)
export const IconChevronLeft = icon(<><path d="M15 6l-6 6 6 6"/></>)
export const IconArrowUp = icon(<><path d="M12 19V5M5 12l7-7 7 7"/></>)
export const IconArrowDown = icon(<><path d="M12 5v14M19 12l-7 7-7-7"/></>)
export const IconArrowRight = icon(<><path d="M5 12h14M12 5l7 7-7 7"/></>)
export const IconExternalLink = icon(<><path d="M18 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h6M15 3h6v6M10 14L21 3"/></>)

// Finance
export const IconWallet = icon(<><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><circle cx="16" cy="14" r="1.5" fill="currentColor" stroke="none"/></>)
export const IconDeposit = icon(<><rect x="2" y="5" width="20" height="16" rx="2"/><path d="M2 10h20M12 15v-3M10 14l2 2 2-2"/></>)
export const IconWithdraw = icon(<><rect x="2" y="5" width="20" height="16" rx="2"/><path d="M2 10h20M12 12v3M10 13l2-2 2 2"/></>)
export const IconTrendUp = icon(<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>)
export const IconTrendDown = icon(<><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></>)
export const IconDollar = icon(<><path d="M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6"/></>)
export const IconCoin = icon(<><circle cx="12" cy="12" r="9"/><path d="M14.5 9a3 3 0 10-3 5.2M9.5 15a3 3 0 103-5.2"/></>)
export const IconPercent = icon(<><path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>)
export const IconSwap = icon(<><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></>)

// Market / Categories
export const IconPolitics = icon(<><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></>)
export const IconSports = icon(<><circle cx="12" cy="12" r="9"/><path d="M12 3a14.5 14.5 0 010 18M3 9h18M3 15h18"/></>)
export const IconEconomics = icon(<><path d="M3 3v18h18"/><path d="M18 12l-5-5-4 4-3-3"/></>)
export const IconCrypto = icon(<><path d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 5.4m5.908 1.042.348-1.97M7.48 20.364l3.126-17.727"/></>)
export const IconWeather = icon(<><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></>)
export const IconTech = icon(<><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>)
export const IconElections = icon(<><path d="M2 20h20M4 20V10l8-7 8 7v10"/><path d="M10 20v-5a2 2 0 014 0v5"/></>)
export const IconBusiness = icon(<><rect x="2" y="7" width="20" height="15" rx="1"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v5M9.5 12h5"/></>)
export const IconHealth = icon(<><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></>)
export const IconGlobe = icon(<><circle cx="12" cy="12" r="9"/><path d="M12 3a14.5 14.5 0 010 18M3 9h18M3 15h18"/></>)
export const IconFire = icon(<><path d="M12 22c5.523 0 10-4.477 10-10 0-3-1.5-6-4-8-1 2-2 3-4 3-1 0-2-1-2-2s-1-2-2-2C5 3 2 7.477 2 12c0 5.523 4.477 10 10 10z"/><path d="M12 22c1.657 0 3-2.686 3-6s-1.343-6-3-6-3 2.686-3 6 1.343 6 3 6z"/></>)
export const IconStar = icon(<><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></>)
export const IconTrophy = icon(<><path d="M6 9H4a2 2 0 010-4h2M18 9h2a2 2 0 000-4h-2"/><path d="M4 5h16v7a8 8 0 01-16 0V5z"/><path d="M12 19v3M8 22h8"/></>)

// UI Actions
export const IconShare = icon(<><circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 12h8M8.59 6.59L15.42 9.4M15.41 14.59l-6.82 2.82"/></>)
export const IconCopy = icon(<><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>)
export const IconCheck = icon(<><polyline points="20 6 9 17 4 12"/></>)
export const IconInfo = icon(<><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></>)
export const IconWarning = icon(<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></>)
export const IconSettings = icon(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></>)
export const IconLogOut = icon(<><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></>)
export const IconFilter = icon(<><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></>)
export const IconClock = icon(<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>)
export const IconCalendar = icon(<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>)
export const IconPlus = icon(<><path d="M12 5v14M5 12h14"/></>)
export const IconMinus = icon(<><path d="M5 12h14"/></>)
export const IconRefresh = icon(<><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></>)
export const IconEye = icon(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>)
export const IconShield = icon(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>)
export const IconKYC = icon(<><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="9" cy="10" r="3"/><path d="M15 8h4M15 12h4M5 17c0-2 2-4 4-4h4c2 0 4 2 4 4"/></>)
export const IconMpesa = icon(<><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M12 8v8"/></>, '0 0 24 24')
export const IconPhone = icon(<><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 17h.01"/></>)
export const IconMail = icon(<><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 7 10-7"/></>)
export const IconPortfolio = icon(<><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></>)
export const IconLeaderboard = icon(<><path d="M8 21V11M12 21V3M16 21V15"/><path d="M4 21h16"/></>)
export const IconComments = icon(<><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></>)
export const IconSell = icon(<><circle cx="12" cy="12" r="9"/><path d="M9 15l6-6M15 9h-4M15 9v4" stroke="currentColor"/></>)

// Logo mark
// Pip brand mark — a rising probability line on a baseline reference with
// square "pip" terminals. Pip Blue by default; pass a solid className/fill to recolor.
// Kichiko brand mark — a Pip-Blue (#1452F0) rounded tile with a white "K"
// (public/logo-tile.svg). A solid colored tile reads clearly on any surface —
// light app chrome, dark app chrome, and the browser tab bar alike — so the mark
// stays crisp and recognizable everywhere (the navy mask-based mark vanished on
// dark browser bars). The tile is square (1:1); `size` sets both width and height.
export const LogoMark = ({ size = 28, className = '' }: { size?: number; className?: string }) => (
  <span
    role="img"
    aria-label="Kichiko"
    className={`inline-block shrink-0 bg-center bg-no-repeat bg-contain ${className}`}
    style={{
      width: `${size}px`,
      height: `${size}px`,
      backgroundImage: 'url(/logo-tile.svg)',
    }}
  />
)

// Category → custom icon mapping (replaces emoji as the category language)
const CATEGORY_ICON: Record<string, (p: IconProps) => React.JSX.Element> = {
  politics: IconPolitics,
  elections: IconElections,
  governance: IconShield,
  sports: IconSports,
  economics: IconEconomics,
  business: IconBusiness,
  crypto: IconCrypto,
  technology: IconTech,
  entertainment: IconStar,
  weather: IconWeather,
  health: IconHealth,
  social: IconUser,
  other: IconMarkets,
}

export function CategoryIcon({ category, size = 16, className = '', style }: IconProps & { category: string }) {
  const C = CATEGORY_ICON[category] ?? IconMarkets
  return <C size={size} className={className} style={style} />
}

// ============================================================
// Admin control-plane glyphs — bespoke, institutional, thin-stroke.
// Same construction grammar as the icons above (24px grid, 1.75 stroke).
// ============================================================
export const IconGrid       = icon(<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>)
export const IconUsers      = icon(<><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.2 2.6-5.4 5.5-5.4s5.5 2.2 5.5 5.4"/><path d="M16 5.2a3.2 3.2 0 010 5.9"/><path d="M17.5 14.9c2.1.6 3.5 2.4 3.5 4.6"/></>)
export const IconPen        = icon(<><path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/></>)
export const IconMegaphone  = icon(<><path d="M3 11v2a1 1 0 001 1h2l3.5 3.5V7.5L6 11H4a1 1 0 00-1 0z"/><path d="M9.5 7.5L19 4v16l-9.5-3.5"/><path d="M6 14v3a2 2 0 004 0"/></>)
export const IconFlag       = icon(<><path d="M5 21V4"/><path d="M5 4h11l-1.5 3.5L16 11H5"/></>)
export const IconCoins      = icon(<><ellipse cx="9" cy="7" rx="5" ry="2.6"/><path d="M4 7v4c0 1.4 2.2 2.6 5 2.6s5-1.2 5-2.6V7"/><path d="M10 14.4c0 1.4 2.2 2.6 5 2.6s5-1.2 5-2.6v-4"/><path d="M10 10.4c.6 1 2.6 1.9 5 1.9 1 0 2-.15 2.8-.4"/></>)
export const IconBanknote   = icon(<><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.4"/><path d="M6 9.5v.01M18 14.5v.01"/></>)
export const IconPlug       = icon(<><path d="M9 3v5M15 3v5"/><path d="M7 8h10v3a5 5 0 01-10 0V8z"/><path d="M12 16v5"/></>)
export const IconKey        = icon(<><circle cx="8" cy="8" r="4"/><path d="M11 11l7 7M16 16l2-2M18 18l1.5-1.5"/></>)
export const IconScroll     = icon(<><path d="M6 4h11a2 2 0 012 2v0a2 2 0 01-2 2H8"/><path d="M6 4a2 2 0 00-2 2v10a2 2 0 002 2h11"/><path d="M17 18a2 2 0 002-2V8"/><path d="M8 9h6M8 12.5h6"/></>)
export const IconDownload   = icon(<><path d="M12 4v11M7 11l5 5 5-5"/><path d="M4 20h16"/></>)
export const IconUpload     = icon(<><path d="M12 20V9M7 13l5-5 5 5"/><path d="M4 4h16"/></>)
export const IconGavel      = icon(<><path d="M13 5l4 4"/><path d="M8.5 9.5l5-5 3.5 3.5-5 5z"/><path d="M6 12l6 6"/><path d="M4 20h9"/></>)
export const IconBan        = icon(<><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></>)
export const IconDots       = icon(<><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></>)
export const IconSort       = icon(<><path d="M8 4v16M8 20l-3-3M8 4l3 3"/><path d="M16 4v16M16 20l3-3M16 4l-3 3" opacity="0.4"/></>)
export const IconLock       = icon(<><rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></>)
export const IconUnlock     = icon(<><rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7a4 4 0 017.5-2"/></>)
export const IconSpinner    = icon(<><path d="M12 3a9 9 0 109 9" /></>)
export const IconBriefcase  = icon(<><rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M8.5 7.5V6a2 2 0 012-2h3a2 2 0 012 2v1.5"/><path d="M3 12.5h18"/></>)
export const IconActivity   = icon(<><path d="M3 12h4l2.5-7 5 14L17 12h4"/></>)
export const IconLink       = icon(<><path d="M10 13a4 4 0 005.7 0l2.6-2.6a4 4 0 00-5.7-5.7L11 6.3"/><path d="M14 11a4 4 0 00-5.7 0l-2.6 2.6a4 4 0 005.7 5.7L13 17.7"/></>)
export const IconAlertTriangle = icon(<><path d="M12 4l9 15.5H3L12 4z"/><path d="M12 10v4M12 17.5v.01"/></>)

// Theme glyphs — same 24px grid + 1.75 stroke as the rest of the set. The sun's
// rays are a single stroked star so it reads crisply at 16–18px; the moon is a
// clean waxing crescent (no notch artifacts) for the dark-mode affordance.
export const IconSun  = icon(<><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></>)
export const IconMoon = icon(<><path d="M20 14.5A8 8 0 019.5 4a1 1 0 00-1.3-1.2A9 9 0 1021.2 15.8 1 1 0 0020 14.5z"/></>)

// Bookmark (watchlist affordance on the market card footer) — same 24px grid
// and 1.75 stroke as the rest of the set; a clean tag with the notched foot.
export const IconBookmark = icon(<><path d="M6 4.5h12a1 1 0 011 1V20l-7-4-7 4V5.5a1 1 0 011-1z"/></>)
// Embed / code — the "</>" affordance in PM's market-drawer header cluster.
export const IconCode = icon(<><path d="M8 6l-6 6 6 6"/><path d="M16 6l6 6-6 6"/></>)
// Shuffle — the chart-footer control next to the timeframe toggles in PM.
export const IconShuffle = icon(<><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M3 3l6 6"/></>)
// Rewards (gift) — traced 1:1 from Polymarket's card-footer icon (viewBox 0 0 18
// 18): a ribboned gift box. Opens the "Earn rewards by placing limit orders"
// affordance on reward-eligible markets.
export const IconGift = icon(
  <>
    <line x1="9" y1="5.25" x2="9" y2="16.25"/>
    <path d="M3.75,3.5c0-.966,.784-1.75,1.75-1.75,2.589,0,3.5,3.5,3.5,3.5h-3.5c-.966,0-1.75-.784-1.75-1.75Z"/>
    <path d="M12.5,5.25h-3.5s.911-3.5,3.5-3.5c.966,0,1.75,.784,1.75,1.75s-.784,1.75-1.75,1.75Z"/>
    <path d="M14.25,8.25v6c0,1.105-.895,2-2,2H5.75c-1.105,0-2-.895-2-2v-6"/>
    <rect x="1.75" y="5.25" width="14.5" height="3" rx="1" ry="1"/>
  </>,
  '0 0 18 18',
)
