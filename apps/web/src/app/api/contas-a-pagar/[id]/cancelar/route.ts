import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Cancelar conta a pagar, com o motivo — NR-150. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/contas-a-pagar/[id]/cancelar'>,
) {
  const { id } = await ctx.params

  return encaminhar(`/contas-a-pagar/${encodeURIComponent(id)}/cancelar`, {
    method: 'POST',
    body: await corpoDe(request),
  })
}
