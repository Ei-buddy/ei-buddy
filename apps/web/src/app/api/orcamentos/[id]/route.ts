import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Um orcamento — NR-159. O PDV le para montar o carrinho. */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/orcamentos/[id]'>) {
  const { id } = await ctx.params
  return encaminhar(`/orcamentos/${encodeURIComponent(id)}`)
}

/** Edicao do orcamento aberto: cliente, itens, validade e desconto. */
export async function PUT(request: NextRequest, ctx: RouteContext<'/api/orcamentos/[id]'>) {
  const { id } = await ctx.params
  return encaminhar(`/orcamentos/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: await corpoDe(request),
  })
}
