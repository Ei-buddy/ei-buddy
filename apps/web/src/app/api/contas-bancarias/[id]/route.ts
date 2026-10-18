import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<'/api/contas-bancarias/[id]'>,
) {
  const { id } = await ctx.params
  return encaminhar(`/contas-bancarias/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Editar a conta — NR-152. */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/contas-bancarias/[id]'>) {
  const { id } = await ctx.params
  return encaminhar(`/contas-bancarias/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: await corpoDe(request),
  })
}
