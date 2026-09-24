import { NextResponse } from 'next/server'
import { chamarApi } from '@/lib/api-server'

/**
 * Conferir o cupom de quem indicou — RF-114, RF-115.
 *
 * NAO usa `encaminhar`: e rota publica do cadastro, e `encaminhar` exige o
 * cookie de sessao — mesmo padrao de `app/api/auth/signup/route.ts`.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params

  const r = await chamarApi(`/cupons/${encodeURIComponent(codigo)}`, { method: 'GET' })

  return NextResponse.json(
    r.ok ? r.dados : (r.corpo ?? { error: { code: r.code, message: r.message } }),
    { status: r.status },
  )
}
