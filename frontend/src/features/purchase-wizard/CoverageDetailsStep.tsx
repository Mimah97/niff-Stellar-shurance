'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { QuoteFormSchema, type QuoteFormData } from '@/lib/schemas/quote'
import { useWallet } from '@/features/wallet'

interface Props {
  defaultValues: Partial<QuoteFormData>
  onNext: (data: QuoteFormData) => void
  onChange: (data: Partial<QuoteFormData>) => void
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="text-sm text-destructive flex items-center gap-1 mt-1" role="alert">
      <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}

export function CoverageDetailsStep({ defaultValues, onNext, onChange }: Props) {
  const { address } = useWallet()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<QuoteFormData>({
    resolver: zodResolver(QuoteFormSchema),
    mode: 'onTouched',
    defaultValues: {
      policy_type: undefined,
      region: undefined,
      coverage_tier: undefined,
      age: undefined,
      risk_score: 5,
      source_account: '',
      ...defaultValues,
    },
  })

  // Pre-fill wallet address
  useEffect(() => {
    if (address && !defaultValues.source_account) {
      setValue('source_account', address)
    }
  }, [address, defaultValues.source_account, setValue])

  // Persist draft on every change
  const values = watch()
  useEffect(() => {
    onChange(values)
  }, [values, onChange])

  return (
    <form
      onSubmit={handleSubmit(onNext)}
      className="space-y-5"
      aria-label="Coverage details"
      noValidate
    >
      <div className="space-y-1">
        <Label htmlFor="policy_type">Policy Type</Label>
        <select
          id="policy_type"
          className={`w-full h-11 rounded-md border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${errors.policy_type ? 'border-destructive' : 'border-input'}`}
          aria-describedby={errors.policy_type ? 'policy_type-error' : undefined}
          {...register('policy_type')}
        >
          <option value="">Select a policy type…</option>
          <option value="Auto">Auto</option>
          <option value="Health">Health</option>
          <option value="Property">Property</option>
        </select>
        <FieldError message={errors.policy_type?.message} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="region">Region Risk Tier</Label>
        <select
          id="region"
          className={`w-full h-11 rounded-md border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${errors.region ? 'border-destructive' : 'border-input'}`}
          {...register('region')}
        >
          <option value="">Select a region…</option>
          <option value="Low">Low Risk</option>
          <option value="Medium">Medium Risk</option>
          <option value="High">High Risk</option>
        </select>
        <FieldError message={errors.region?.message} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="coverage_tier">Coverage Tier</Label>
        <select
          id="coverage_tier"
          className={`w-full h-11 rounded-md border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${errors.coverage_tier ? 'border-destructive' : 'border-input'}`}
          {...register('coverage_tier')}
        >
          <option value="">Select a tier…</option>
          <option value="Basic">Basic</option>
          <option value="Standard">Standard</option>
          <option value="Premium">Premium</option>
        </select>
        <FieldError message={errors.coverage_tier?.message} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="age">Your Age</Label>
        <input
          id="age"
          type="number"
          min={1}
          max={120}
          className={`w-full h-11 rounded-md border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${errors.age ? 'border-destructive' : 'border-input'}`}
          {...register('age', { valueAsNumber: true })}
        />
        <FieldError message={errors.age?.message} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="risk_score">Risk Score (1–10)</Label>
        <input
          id="risk_score"
          type="number"
          min={1}
          max={10}
          className={`w-full h-11 rounded-md border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${errors.risk_score ? 'border-destructive' : 'border-input'}`}
          {...register('risk_score', { valueAsNumber: true })}
        />
        <FieldError message={errors.risk_score?.message} />
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit">Get Quote</Button>
      </div>
    </form>
  )
}
