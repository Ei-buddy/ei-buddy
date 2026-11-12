import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Encerrar o chamado — NR-215. */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return encaminhar(`/admin/chamados/${encodeURIComponent(id)}/encerrar`, { method: 'POST' })
}
