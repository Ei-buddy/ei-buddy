import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import ComprasView from '@/components/compras/ComprasView'

export const metadata: Metadata = {
  title: `Entrada de mercadoria — ${BRAND}`,
  description: 'Compra de fornecedor: soma ao estoque, atualiza o custo e lança a conta a pagar.',
}

export default function ComprasPage() {
  return <ComprasView />
}
