import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** O extrato da conta no periodo (`?from=&to=`) — repassa a busca como veio. */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/contas-bancarias/[id]/extrato'>,
) {
  const { id } = await ctx.params
  return encaminhar(`/contas-bancarias/${encodeURIComponent(id)}/extrato${request.nextUrl.search}`)
}
