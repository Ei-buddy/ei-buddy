import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Cancelar a nota da venda — RF-050. O prazo e a SEFAZ decidem no servidor. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/vendas/[id]/nota/cancelamento'>,
) {
  const { id } = await ctx.params
  return encaminhar(`/vendas/${encodeURIComponent(id)}/nota/cancelamento`, {
    method: 'POST',
    body: await corpoDe(request),
  })
}
