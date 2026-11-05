import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

type Ctx = RouteContext<'/api/cadastros/fornecedores/[id]'>

const caminho = async (ctx: Ctx) =>
  `/cadastros/fornecedores/${encodeURIComponent((await ctx.params).id)}`

export async function GET(_request: NextRequest, ctx: Ctx) {
  return encaminhar(await caminho(ctx))
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  return encaminhar(await caminho(ctx), { method: 'PATCH', body: await corpoDe(request) })
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  return encaminhar(await caminho(ctx), { method: 'DELETE' })
}
