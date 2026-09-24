import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Devolver parte da venda — RF-044. O servidor calcula o valor e devolve o estoque. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/vendas/[id]/devolucao'>) {
  const { id } = await ctx.params

  return encaminhar(`/sales/${encodeURIComponent(id)}/devolucao`, {
    method: 'POST',
    body: await corpoDe(request),
  })
}
