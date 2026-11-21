import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Pedir a NFS-e — NR-241. O servidor enfileira e responde 202 "processando". */
export async function POST(_request: NextRequest, ctx: RouteContext<'/api/vendas/[id]/nfse'>) {
  const { id } = await ctx.params

  return encaminhar(`/vendas/${encodeURIComponent(id)}/nfse`, { method: 'POST' })
}

/** O estado da NFS-e da venda — NR-241. A visita consulta o provedor. */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/vendas/[id]/nfse'>) {
  const { id } = await ctx.params

  return encaminhar(`/vendas/${encodeURIComponent(id)}/nfse`)
}
