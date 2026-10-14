import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Editar ou remarcar um compromisso — NR-152. */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/agenda/[id]'>) {
  const { id } = await ctx.params

  return encaminhar(`/agenda/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: await corpoDe(request),
  })
}
