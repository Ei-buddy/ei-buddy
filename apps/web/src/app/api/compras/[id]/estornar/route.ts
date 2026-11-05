import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Estorno da compra — achado do QA. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/compras/[id]/estornar'>) {
  const { id } = await ctx.params
  return encaminhar(`/compras/${encodeURIComponent(id)}/estornar`, {
    method: 'POST',
    body: await corpoDe(request),
  })
}
