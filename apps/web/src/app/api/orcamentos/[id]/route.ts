import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Um orcamento — NR-159. O PDV le para montar o carrinho. */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/orcamentos/[id]'>) {
  const { id } = await ctx.params
  return encaminhar(`/orcamentos/${encodeURIComponent(id)}`)
}
