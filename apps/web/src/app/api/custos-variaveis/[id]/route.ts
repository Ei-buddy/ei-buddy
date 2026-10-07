import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Excluir um custo variavel. */
export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<'/api/custos-variaveis/[id]'>,
) {
  const { id } = await ctx.params

  return encaminhar(`/custos-variaveis/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Editar nome e percentual — NR-152. */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/custos-variaveis/[id]'>) {
  const { id } = await ctx.params

  return encaminhar(`/custos-variaveis/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: await corpoDe(request),
  })
}
