// app/admin/settings/gateways/new/page.tsx — Create a new gateway.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { GatewayForm } from '@/components/admin/settings/GatewayForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · New Gateway' }

export default async function NewGatewayPage() {
  await requirePageCapability('gateways:write')
  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/admin/settings/gateways" className="text-sm text-muted-foreground hover:underline">← Gateways</Link>
        <h1 className="text-2xl font-black">New Gateway</h1>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Create the non-secret configuration first. After saving, add encrypted secrets (keys, passkeys, PINs) and run a connection test.
      </p>
      <GatewayForm />
    </div>
  )
}
