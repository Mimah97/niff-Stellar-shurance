import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getConfig } from '@/config/env'
import { PolicyDtoSchema, type PolicyDto } from '@/features/policies/api'
import { RenewalClient } from '@/features/policies/components/RenewalClient'

interface RenewPageProps {
  params: Promise<{ id: string }>
}

async function fetchPolicyById(id: string): Promise<PolicyDto | null> {
  try {
    const { apiUrl } = getConfig()
    const res = await fetch(`${apiUrl}/api/policies/${encodeURIComponent(id)}`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    const data = await res.json()
    const parsed = PolicyDtoSchema.safeParse(data)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: RenewPageProps): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Renew Policy #${id}`,
    description: `Renew your insurance policy #${id} on NiffyInsur.`,
  }
}

export default async function RenewPage({ params }: RenewPageProps) {
  const { id } = await params
  const policy = await fetchPolicyById(id)

  if (!policy) notFound()

  return <RenewalClient policy={policy} policyId={id} />
}
