'use client'

// app/markets/create/page.tsx — Create a market (authoring wizard)
// Thin client wrapper: guards auth, then hands off to the CreateWizard.
import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { CreateWizard } from '@/components/markets/create/create-wizard'
import { IconArrowRight } from '@/components/ui/icons'

export default function CreateMarketPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login?next=/markets/create')
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="skeleton h-9 w-56 rounded-md" />
        <div className="skeleton mt-4 h-6 w-full max-w-md rounded-md" />
        <div className="skeleton mt-8 h-96 w-full rounded-md" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-display text-2xl text-text-primary">Sign in to create an event</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">
          You need an account to author and publish prediction markets.
        </p>
        <Link href="/auth/login?next=/markets/create" className="btn btn-primary mt-6">
          Sign in <IconArrowRight size={15} />
        </Link>
      </div>
    )
  }

  return <CreateWizard user={user} />
}
