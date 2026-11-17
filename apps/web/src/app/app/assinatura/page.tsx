import type { Metadata } from 'next'
import AssinaturaView from '@/components/billing/AssinaturaView'

export const metadata: Metadata = {
  title: 'Assinatura',
}

export default function AssinaturaPage() {
  return <AssinaturaView />
}
