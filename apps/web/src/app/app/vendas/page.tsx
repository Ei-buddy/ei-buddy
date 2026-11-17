import type { Metadata } from 'next'
import HistoricoVendas from '@/components/vendas/HistoricoVendas'

export const metadata: Metadata = {
  title: 'Vendas',
  description: 'Histórico de vendas fechadas.',
}

export default function VendasPage() {
  return <HistoricoVendas />
}
