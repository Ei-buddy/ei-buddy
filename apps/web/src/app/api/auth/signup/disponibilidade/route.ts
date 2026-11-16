import { NextResponse } from 'next/server'
import { chamarApi } from '@/lib/api-server'
import { corpoDe } from '@/lib/bff'

/**
 * Conferencia antecipada do cadastro — achado do QA.
 *
 * Publica, como o cadastro: quem pergunta ainda nao tem sessao. So repassa a
 * pergunta e a resposta; quem decide e a api.
 */
export async function POST(request: Request) {
  const r = await chamarApi<{ conflicts: { field: string; message: string }[] }>(
    '/auth/signup/disponibilidade',
    { method: 'POST', body: await corpoDe(request) },
  )
  if (!r.ok) {
    return NextResponse.json(r.corpo ?? { error: { code: r.code, message: r.message } }, {
      status: r.status,
    })
  }
  return NextResponse.json(r.dados)
}
