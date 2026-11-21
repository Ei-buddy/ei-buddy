import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Cancelar a NFS-e da venda — NR-241. O Ambiente Nacional decide o prazo. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/vendas/[id]/nfse/cancelamento'>,
) {
  const { id } = await ctx.params
  return encaminhar(`/vendas/${encodeURIComponent(id)}/nfse/cancelamento`, {
    method: 'POST',
    body: await corpoDe(request),
  })
}
