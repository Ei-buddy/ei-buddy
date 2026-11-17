import type { Metadata } from 'next'
import OrcamentosView from '@/components/orcamentos/OrcamentosView'

export const metadata: Metadata = {
  title: 'Orçamentos',
  description: 'Orçamentos para o cliente: sem baixar estoque, compartilháveis e que viram venda.',
}

export default function OrcamentosPage() {
  return <OrcamentosView />
}
