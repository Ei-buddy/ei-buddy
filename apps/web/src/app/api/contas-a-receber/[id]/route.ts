import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Corrigir recebivel avulso lancado errado — NR-150. */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/contas-a-receber/[id]'>) {
  const { id } = await ctx.params

  return encaminhar(`/contas-a-receber/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: await corpoDe(request),
  })
}
