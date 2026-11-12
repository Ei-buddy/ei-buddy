import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Um chamado com a conversa inteira — NR-215. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return encaminhar(`/admin/chamados/${encodeURIComponent(id)}`)
}
