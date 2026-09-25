import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<'/api/contas-bancarias/[id]'>,
) {
  const { id } = await ctx.params
  return encaminhar(`/contas-bancarias/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
