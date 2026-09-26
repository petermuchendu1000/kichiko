// app/api/profile — read & update the signed-in user's editable profile.
//
// GET   -> current editable profile fields for the account settings surface.
// PATCH -> partial update of display name / username / bio / phone / avatar.
//          RLS scopes every write to the caller's own row (the update is
//          filtered by id === user.id defensively too). Country and currency
//          are NOT editable here: the settlement currency is the currency of
//          the user's country and changes only through POST /api/profile/country
//          (set_my_country, migration 079).
//
// Username uniqueness is enforced by a DB constraint; we translate the unique
// violation into a friendly 409 so the settings UI can highlight the field.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Use only letters, numbers and underscores')

const schema = z
  .object({
    display_name: z.string().trim().min(1).max(60).optional(),
    username: usernameSchema.optional(),
    bio: z.string().trim().max(280).optional(),
    phone_number: z
      .string()
      .trim()
      .regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid phone number')
      .optional()
      .or(z.literal('')),
    // Avatar URL must be a public object from our own `avatars` storage bucket
    // (the client uploads there and passes back the returned public URL). Empty
    // string clears the avatar.
    avatar_url: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((u) => u.includes('/storage/v1/object/public/avatars/'), 'Invalid avatar URL')
      .optional()
      .or(z.literal('')),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields provided' })

export async function GET() {
  const guard = await requireUser()
  if (!guard.ok) return guard.response

  const { data, error } = await guard.ctx.supabase.rpc('get_my_profile').maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ profile: data, email: guard.ctx.user.email })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  if (body && typeof body === 'object' && ('country_code' in body || 'preferred_currency' in body)) {
    return NextResponse.json(
      { error: 'Your country (and with it your settlement currency) is changed through /api/profile/country' },
      { status: 400 }
    )
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const guard = await requireUser()
  if (!guard.ok) return guard.response

  // Build a typed partial update. Empty optional strings become null so the
  // field is cleared rather than stored as "".
  const d = parsed.data
  const nn = (v: string | undefined) => (v === undefined || v === '' ? null : v)
  const updates = {
    ...(d.display_name !== undefined && { display_name: d.display_name }),
    ...(d.username !== undefined && { username: d.username }),
    ...(d.bio !== undefined && { bio: nn(d.bio) }),
    ...(d.phone_number !== undefined && { phone_number: nn(d.phone_number) }),
    ...(d.avatar_url !== undefined && { avatar_url: nn(d.avatar_url) }),
  }

  const { error } = await guard.ctx.supabase
    .from('profiles')
    .update(updates)
    .eq('id', guard.ctx.user.id)

  if (error) {
    // 23505 = unique_violation (username taken).
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'That username is already taken', field: 'username' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Return the caller's own updated row via the self-scoped RPC.
  const { data } = await guard.ctx.supabase.rpc('get_my_profile').maybeSingle()
  return NextResponse.json({ success: true, profile: data })
}
