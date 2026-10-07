import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Corrigir conta a pagar lancado errado — NR-150. */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/contas-a-pagar/[id]'>) {
  const { id } = await ctx.params

  return encaminhar(`/contas-a-pagar/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: await corpoDe(request),
  })
}
