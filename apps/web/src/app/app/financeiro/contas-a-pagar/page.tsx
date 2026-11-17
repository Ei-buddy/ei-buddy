import type { Metadata } from 'next'
import ContasView from '@/components/financeiro/ContasView'

export const metadata: Metadata = {
  title: 'Contas a pagar',
  description: 'Titulos, vencimentos e baixas.',
}

export default function ContasPagarPage() {
  return <ContasView tipo="pagar" />
}
