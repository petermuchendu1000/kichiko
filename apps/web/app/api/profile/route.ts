// app/api/profile — read & update the signed-in user's editable profile.
//
// GET   -> current editable profile fields for the account settings surface.
// PATCH -> partial update of display name / username / bio / phone / country /
//          preferred display currency. RLS scopes every write to the caller's
//          own row (the update is filtered by id === user.id defensively too).
//
// Username uniqueness is enforced by a DB constraint; we translate the unique
// violation into a friendly 409 so the settings UI can highlight the field.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'

// East/central-African settlement currencies + USD (matches currency_code enum).
const CURRENCIES = ['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD'] as const

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
    country_code: z.string().trim().length(2).toUpperCase().optional().or(z.literal('')),
    preferred_currency: z.enum(CURRENCIES).optional(),
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

const COLUMNS =
  'display_name, username, bio, phone_number, country_code, preferred_currency, avatar_url, kyc_status, account_status, referral_code'

export async function GET() {
  const guard = await requireUser()
  if (!guard.ok) return guard.response

  const { data, error } = await guard.ctx.supabase
    .from('profiles')
    .select(COLUMNS)
    .eq('id', guard.ctx.user.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ profile: data, email: guard.ctx.user.email })
}

export async function PATCH(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
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
    ...(d.country_code !== undefined && { country_code: nn(d.country_code) }),
    ...(d.preferred_currency !== undefined && { preferred_currency: d.preferred_currency }),
    ...(d.avatar_url !== undefined && { avatar_url: nn(d.avatar_url) }),
  }

  const { data, error } = await guard.ctx.supabase
    .from('profiles')
    .update(updates)
    .eq('id', guard.ctx.user.id)
    .select(COLUMNS)
    .single()

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

  return NextResponse.json({ success: true, profile: data })
}
