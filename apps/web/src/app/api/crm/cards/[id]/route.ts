import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Mover um card entre colunas — NR-109. */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return encaminhar(`/crm/cards/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: await request.json().catch(() => ({})),
  })
}

/** Excluir o card (pendencia ou contato) — NR-213. */
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return encaminhar(`/crm/cards/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
