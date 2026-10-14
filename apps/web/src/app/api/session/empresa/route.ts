import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { chamarApi } from '@/lib/api-server'
import { DURACAO_DO_COOKIE_SEGUNDOS, opcoesDoCookie, SESSION_COOKIE } from '@/lib/session'

/**
 * Escolher a loja a operar — RF-119, US-059.
 *
 * Quem tem acesso a mais de uma loja entra e **depois** escolhe. Ate escolher,
 * a sessao nao tem papel e nenhuma rota de negocio funciona — e por isso esta
 * chamada troca o cookie por um novo, com a empresa dentro.
 */

type SessaoDaApi = {
  token: string
  expiresAt: string
  userId: string
  userName: string
  memberships: { companyId: string; companyName: string; role: string }[]
  activeCompanyId: string | null
  isPlatformAdmin: boolean
}

export async function POST(request: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value

  if (token === undefined) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Entre na sua conta para continuar.' } },
      { status: 401 },
    )
  }

  const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const r = await chamarApi<SessaoDaApi>('/auth/select-company', {
    method: 'POST',
    body: corpo,
    token,
  })

  if (!r.ok) {
    return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status })
  }

  const resposta = NextResponse.json(semToken(r.dados))
  /*
   * Substitui o cookie, e o token antigo JA NAO VALE MAIS.
   *
   * Este comentario dizia o contrario — "o token antigo continua valido na api
   * ate expirar, nao ha revogacao, a sessao e por token assinado, nao por
   * tabela". Era verdade e virou mentira na NR-083: a sessao passou a ser linha
   * no Postgres e `selectCompany` revoga o token apresentado depois de emitir o
   * novo. Trocar de loja durante o dia deixava uma credencial viva por troca.
   */
  resposta.cookies.set(SESSION_COOKIE, r.dados.token, opcoesDoCookie(DURACAO_DO_COOKIE_SEGUNDOS))
  return resposta
}

function semToken(sessao: SessaoDaApi): Omit<SessaoDaApi, 'token'> {
  const resto: Partial<SessaoDaApi> = { ...sessao }
  delete resto.token
  return resto as Omit<SessaoDaApi, 'token'>
}
