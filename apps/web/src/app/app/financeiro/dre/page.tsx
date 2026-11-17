import type { Metadata } from 'next'
import DreView from '@/components/financeiro/DreView'

export const metadata: Metadata = {
  title: 'DRE',
  description: 'Receita, custo, despesa e resultado do período.',
}

export default function DrePage() {
  return <DreView />
}
