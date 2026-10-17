// scripts/check-kyc-decision-rpc.mjs
// ---------------------------------------------------------------------------
// Exercise apply_didit_decision() on both terminal outcomes, against the live
// schema, and roll back.
//
// WHY THIS EXISTS
// The function failed on EVERY approval with
//   column "type" is of type notification_type but expression is of type text
// because a CASE of two unknown literals resolves to text and text does not
// implicitly cast into an enum column. It raised at runtime, inside a SECURITY
// DEFINER function, on the single path that matters.
//
// Nothing caught it because every webhook test used a session in "Not Started",
// which mapStatus() maps to null, so the handler returned before reaching the
// INSERT. The signature path was tested exhaustively and the path that
// verifies somebody was never run once. A real user finished a real scan and
// found out for us.
//
// A regex over the migration files was tried first and was worse than useless:
// it missed `::public.notification_type`, mis-indexed three other INSERTs, and
// flagged superseded history. This runs the function instead.
//
// Usage:
//   SUPABASE_PROJECT_REF=... SUPABASE_ACCESS_TOKEN=... node apps/web/scripts/check-kyc-decision-rpc.mjs
const ref = process.env.SUPABASE_PROJECT_REF
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!ref || !token) {
  console.error('SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required')
  process.exit(2)
}

const run = async (query) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

// One transaction, rolled back: the real function, the real enum, the real
// constraints, and nothing left behind. A profile row is required because
// apply_didit_decision updates it and notifications references it.
const probe = (status) => `
DO $$
DECLARE
  v_user UUID := gen_random_uuid();
  v_sess UUID := gen_random_uuid();
  v_out  JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'rpc-probe-' || v_user || '@elopis.test', now(), now());

  v_out := public.apply_didit_decision(
    v_user, v_sess, '${status}'::kyc_status, '${status === 'verified' ? 'Approved' : 'Declined'}',
    '{"status":"${status === 'verified' ? 'Approved' : 'Declined'}"}'::jsonb,
    ${status === 'verified' ? 'NULL' : "'probe reason'"},
    'national_id', 'PROBE123', '1990-01-01', 'KE', '2030-01-01'
  );

  IF (v_out->>'kyc_doc_id') IS NULL THEN
    RAISE EXCEPTION 'no kyc_documents row written for %', '${status}';
  END IF;
  IF (SELECT kyc_status FROM public.profiles WHERE id = v_user) <> '${status}'::kyc_status THEN
    RAISE EXCEPTION 'profile not moved to % ', '${status}';
  END IF;
  IF (SELECT count(*) FROM public.notifications WHERE user_id = v_user) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one notification for %', '${status}';
  END IF;

  -- Everything above proved itself; undo it.
  RAISE EXCEPTION 'ROLLBACK_OK';
END;
$$;`

let failures = 0
for (const status of ['verified', 'rejected']) {
  try {
    await run(probe(status))
    console.log(`FAIL ${status.padEnd(9)} the probe did not reach its own rollback`)
    failures++
  } catch (err) {
    const msg = String(err.message)
    if (msg.includes('ROLLBACK_OK')) {
      console.log(`ok   ${status.padEnd(9)} document row, profile and notification all written`)
    } else {
      console.log(`FAIL ${status.padEnd(9)} ${msg.replace(/\s+/g, ' ').slice(0, 220)}`)
      failures++
    }
  }
}
console.log(failures === 0 ? '\napply_didit_decision works on both terminal outcomes.' : `\n${failures} failing.`)
process.exit(failures === 0 ? 0 : 1)
