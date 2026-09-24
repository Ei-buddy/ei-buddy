import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Cancelar a venda inteira — RF-043. O servidor devolve estoque e recebivel juntos. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/vendas/[id]/cancelar'>) {
  const { id } = await ctx.params

  return encaminhar(`/sales/${encodeURIComponent(id)}/cancelar`, {
    method: 'POST',
    body: await corpoDe(request),
  })
}
