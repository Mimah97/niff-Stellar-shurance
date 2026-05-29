import type { Metadata } from 'next'
import { PurchaseWizard } from '@/features/purchase-wizard/PurchaseWizard'

export const metadata: Metadata = {
  title: 'Purchase Insurance Policy',
  description: 'Complete your insurance policy purchase in 3 steps.',
}

export default function PurchasePage() {
  return <PurchaseWizard />
}
