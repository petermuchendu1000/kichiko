import { NextResponse } from 'next/server'

/**
 * GET /api/leaderboard — gone.
 *
 * The public profit/volume/win-rate ranking was removed (work plan v2 §6.3; see
 * app/leaderboard/page.tsx). Serving the same ranking here would keep the winner
 * feed public through the API. The ranking logic in lib/leaderboard.ts stays for
 * the opt-in accuracy board that replaces it.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'The leaderboard is paused while it is rebuilt as an opt-in accuracy board.' },
    { status: 410, headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
