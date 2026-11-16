import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import DreView from '@/components/financeiro/DreView'

export const metadata: Metadata = {
  title: `DRE — ${BRAND}`,
  description: 'Receita, custo, despesa e resultado do período.',
}

export default function DrePage() {
  return <DreView />
}
