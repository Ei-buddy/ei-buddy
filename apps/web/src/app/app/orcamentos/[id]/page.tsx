import type { Metadata } from 'next'
import OrcamentoFicha from '@/components/orcamentos/OrcamentoFicha'

export const metadata: Metadata = {
  title: 'Orçamento',
  description: 'Orçamento para imprimir, mandar pelo WhatsApp ou converter em venda.',
}

export default async function OrcamentoPage({ params }: PageProps<'/app/orcamentos/[id]'>) {
  const { id } = await params
  return <OrcamentoFicha id={id} />
}
