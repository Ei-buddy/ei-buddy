import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Registra a venda que nasceu do orcamento — NR-159. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/orcamentos/[id]/converter'>,
) {
  const { id } = await ctx.params
  return encaminhar(`/orcamentos/${encodeURIComponent(id)}/converter`, {
    method: 'POST',
    body: await corpoDe(request),
  })
}
