import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { buscarVenda } from '@/lib/vendas-server'
import VendaDetalhe from '@/components/vendas/VendaDetalhe'

export async function generateMetadata({
  params,
}: PageProps<'/app/vendas/[id]'>): Promise<Metadata> {
  const { id } = await params
  const venda = await buscarVenda(id)

  return {
    title: venda ? `Venda #${venda.numero}` : 'Venda',
  }
}

export default async function VendaDetalhePage({ params }: PageProps<'/app/vendas/[id]'>) {
  const { id } = await params
  const venda = await buscarVenda(id)

  if (!venda) notFound()

  return <VendaDetalhe venda={venda} />
}
