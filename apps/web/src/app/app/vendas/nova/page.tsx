import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import PdvWizard from '@/components/vendas/PdvWizard'

export const metadata: Metadata = {
  title: `Nova venda — ${BRAND}`,
  description: 'Ponto de venda: cliente, carrinho, pagamento e nota fiscal.',
}

export default async function NovaVendaPage({ searchParams }: PageProps<'/app/vendas/nova'>) {
  /* `?orcamento=<id>`: o PDV abre com o carrinho do orcamento — NR-159. */
  const { orcamento } = await searchParams
  return <PdvWizard orcamentoId={typeof orcamento === 'string' ? orcamento : null} />
}
