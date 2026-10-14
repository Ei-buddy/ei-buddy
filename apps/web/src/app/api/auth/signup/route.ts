import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { chamarApi } from '@/lib/api-server'
import { corpoDe } from '@/lib/bff'
import { SESSION_COOKIE } from '@/lib/session'

/**
 * Cadastro de conta — NR-014, RF-001, RF-002.
 *
 * NAO usa `encaminhar`: esta rota e publica, e `encaminhar` exige o cookie de
 * sessao. Quem cadastra ainda nao tem sessao — e sai daqui com uma.
 *
 * O token vai para o cookie `httpOnly` na mesma resposta, como no login: e o
 * unico jeito de a pessoa entrar direto no sistema depois de cadastrar. Sem
 * isso ela veria "conta criada" e cairia numa tela de login para digitar o que
 * acabou de digitar.
 */
export async function POST(request: Request) {
  const corpo = await corpoDe(request)

  const r = await chamarApi<{ token: string; expiresAt: string }>('/auth/signup', {
    method: 'POST',
    body: corpo,
  })

  if (!r.ok) {
    return NextResponse.json(r.corpo ?? { error: { code: r.code, message: r.message } }, {
      status: r.status,
    })
  }

  const loja = await cookies()
  loja.set(SESSION_COOKIE, r.dados.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(r.dados.expiresAt),
  })

  /* O token NAO volta no corpo: ele ja esta no cookie, e devolve-lo o
     entregaria ao JavaScript da pagina — onde um XSS o levaria. */
  const semSegredo: Record<string, unknown> = { ...r.dados }
  delete semSegredo.token

  return NextResponse.json(semSegredo, { status: 201 })
}
