import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Responder como "Suporte EiBuddy" — NR-215. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return encaminhar(`/admin/chamados/${encodeURIComponent(id)}/respostas`, {
    method: 'POST',
    body: await corpoDe(request),
  })
}
