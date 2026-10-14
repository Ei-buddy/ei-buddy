import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Cancelar orcamento — NR-159. */
export async function POST(
  _request: NextRequest,
  ctx: RouteContext<'/api/orcamentos/[id]/cancelar'>,
) {
  const { id } = await ctx.params
  return encaminhar(`/orcamentos/${encodeURIComponent(id)}/cancelar`, { method: 'POST' })
}
