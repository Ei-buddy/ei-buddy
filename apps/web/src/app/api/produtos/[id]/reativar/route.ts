import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Reativar produto — NR-151. */
export async function POST(
  _request: NextRequest,
  ctx: RouteContext<'/api/produtos/[id]/reativar'>,
) {
  const { id } = await ctx.params

  return encaminhar(`/produtos/${encodeURIComponent(id)}/reativar`, { method: 'POST' })
}
