import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { buscarVenda } from '@/lib/vendas-server'
import ComprovanteVenda from '@/components/vendas/ComprovanteVenda'

export async function generateMetadata({
  params,
}: PageProps<'/app/vendas/[id]/comprovante'>): Promise<Metadata> {
  const { id } = await params
  const venda = await buscarVenda(id)
  return { title: venda ? `Comprovante #${venda.numero}` : 'Comprovante' }
}

/** Comprovante nao fiscal da venda — NR-154. */
export default async function ComprovantePage({
  params,
}: PageProps<'/app/vendas/[id]/comprovante'>) {
  const { id } = await params
  const venda = await buscarVenda(id)

  if (!venda) notFound()

  return <ComprovanteVenda venda={venda} />
}
