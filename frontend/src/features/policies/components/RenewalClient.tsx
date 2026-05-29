'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { useWallet } from '@/features/wallet'
import { generatePremium } from '@/lib/api/quote'
import { PolicyAPI, PolicyError, getPolicyErrorMessage } from '@/lib/api/policy'
import { formatXlm } from './PolicyItem'
import type { PolicyDto } from '../api'

const RenewalFormSchema = z.object({
  coverage_tier: z.enum(['Basic', 'Standard', 'Premium']),
})
type RenewalFormData = z.infer<typeof RenewalFormSchema>

// Derive a coverage_tier from the existing premium_amount (heuristic: compare to coverage_amount)
function inferTier(policy: PolicyDto): 'Basic' | 'Standard' | 'Premium' {
  const premium = BigInt(policy.coverage_summary.premium_amount)
  const coverage = BigInt(policy.coverage_summary.coverage_amount)
  if (coverage === 0n) return 'Basic'
  // ratio: premium / coverage * 1000 (basis points × 10)
  const ratio = Number((premium * 1000n) / coverage)
  if (ratio >= 15) return 'Premium'
  if (ratio >= 8) return 'Standard'
  return 'Basic'
}

interface Props {
  policy: PolicyDto
  policyId: string
}

export function RenewalClient({ policy, policyId }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const { address, signTransaction } = useWallet()

  const defaultTier = inferTier(policy)

  const { register, formState: { errors } } = useForm<RenewalFormData>({
    resolver: zodResolver(RenewalFormSchema),
    defaultValues: { coverage_tier: defaultTier },
  })

  // Track selected tier in local state so the useEffect dependency works reliably
  const [selectedTier, setSelectedTier] = useState<'Basic' | 'Standard' | 'Premium'>(defaultTier)

  // Live premium recalculation
  const [premium, setPremium] = useState<string | null>(null)
  const [premiumLoading, setPremiumLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPremiumLoading(true)
    setPremium(null)

    generatePremium({
      policy_type: policy.policy_type,
      region: policy.region,
      coverage_tier: selectedTier,
      // Use placeholder values for age/risk_score since we don't have them on the DTO
      age: 30,
      risk_score: 5,
      source_account: address ?? '',
    })
      .then((result) => {
        if (!cancelled) setPremium(result.premiumStroops)
      })
      .catch(() => {
        if (!cancelled) setPremium(null)
      })
      .finally(() => {
        if (!cancelled) setPremiumLoading(false)
      })

    return () => { cancelled = true }
  }, [selectedTier, policy.policy_type, policy.region, address])

  // Submission state
  const [step, setStep] = useState<'form' | 'signing' | 'done' | 'error'>('form')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!address) {
      toast({ title: 'Wallet not connected', description: 'Please connect your wallet first.', variant: 'destructive' })
      return
    }
    setStep('signing')
    try {
      const tx = await PolicyAPI.initiateRenewal({
        holder: policy.holder,
        policyId: policy.policy_id,
        walletAddress: address,
        coverageTier: selectedTier,
      })
      const signed = await signTransaction(tx.transactionXdr)
      const result = await PolicyAPI.submitTransaction(signed, '')
      setTxHash(result.transactionHash)
      setStep('done')
      toast({ title: 'Renewal submitted', description: 'Your policy renewal has been submitted.' })
    } catch (err) {
      const msg = err instanceof PolicyError ? getPolicyErrorMessage(err) : (err instanceof Error ? err.message : 'Renewal failed')
      setErrorMsg(msg)
      setStep('error')
      toast({ title: 'Renewal failed', description: msg, variant: 'destructive' })
    }
  }

  if (step === 'done') {
    return (
      <main className="mx-auto max-w-xl px-4 py-8 space-y-6">
        <div className="text-center space-y-4">
          <p className="text-lg font-semibold text-green-700">Renewal submitted ✓</p>
          {txHash && <p className="text-xs text-gray-500 break-all font-mono">Tx: {txHash}</p>}
          <Button onClick={() => router.push(`/policies/${policyId}`)}>View Policy</Button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <Link href={`/policies/${policyId}`} className="text-sm text-blue-600 hover:underline">
          ← Policy #{policy.policy_id}
        </Link>
        <Badge variant={policy.is_active ? 'default' : 'secondary'}>
          {policy.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <h1 className="text-2xl font-bold">Renew Policy #{policy.policy_id}</h1>

      {/* Current coverage summary */}
      <Card>
        <CardHeader><CardTitle className="text-base">Current Coverage</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">Type</dt>
              <dd className="font-medium">{policy.policy_type}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Region</dt>
              <dd className="font-medium">{policy.region}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Coverage</dt>
              <dd className="font-mono">{formatXlm(policy.coverage_summary.coverage_amount)} XLM</dd>
            </div>
            <div>
              <dt className="text-gray-500">Current Premium</dt>
              <dd className="font-mono">{formatXlm(policy.coverage_summary.premium_amount)} XLM/yr</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Renewal form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Renewal Options</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="coverage_tier">Coverage Tier</Label>
              <select
                id="coverage_tier"
                className="w-full h-11 rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register('coverage_tier')}
                onChange={(e) => {
                  void register('coverage_tier').onChange(e)
                  setSelectedTier(e.target.value as 'Basic' | 'Standard' | 'Premium')
                }}
              >
                <option value="Basic">Basic</option>
                <option value="Standard">Standard</option>
                <option value="Premium">Premium</option>
              </select>
              {errors.coverage_tier && (
                <p className="text-sm text-destructive mt-1">{errors.coverage_tier.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Renewal summary */}
        <Card>
          <CardHeader><CardTitle className="text-base">Renewal Summary</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Policy Type</dt>
                <dd className="font-medium">{policy.policy_type}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Region</dt>
                <dd className="font-medium">{policy.region}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Coverage Tier</dt>
                <dd className="font-medium">{selectedTier}</dd>
              </div>
              <div className="flex justify-between border-t pt-2">
                <dt className="text-gray-500">New Annual Premium</dt>
                <dd className="font-mono font-semibold">
                  {premiumLoading ? (
                    <span className="flex items-center gap-1 text-gray-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Calculating…
                    </span>
                  ) : premium ? (
                    `${formatXlm(premium)} XLM/yr`
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-gray-400 mt-3">
              ⓘ Premium is recalculated live. Final amount is confirmed on-chain at signing.
            </p>
          </CardContent>
        </Card>

        {step === 'error' && (
          <p className="text-sm text-red-600 rounded-md bg-red-50 border border-red-200 p-3">{errorMsg}</p>
        )}

        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => router.push(`/policies/${policyId}`)}>
            Cancel
          </Button>
          <Button type="submit" disabled={step === 'signing' || !address} className="flex-1">
            {step === 'signing' ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing…</>
            ) : (
              'Sign & Renew'
            )}
          </Button>
        </div>
      </form>
    </main>
  )
}
