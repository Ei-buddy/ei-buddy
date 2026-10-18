import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { chamarApi } from '@/lib/api-server'
import { DURACAO_DO_COOKIE_SEGUNDOS, opcoesDoCookie, SESSION_COOKIE } from '@/lib/session'

/**
 * Sessao — NR-013, US-059.
 *
 * Este handler e a fronteira: o navegador fala com ele, ele fala com a api, e o
 * token da api **nunca atravessa de volta**. Ver `api-server.ts` para o porque.
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

/** Entrar. */
export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const r = await chamarApi<SessaoDaApi>('/auth/login', { method: 'POST', body: corpo })

  if (!r.ok) {
    /*
     * Repassa o status da api, incluindo 429. A tela precisa distinguir
     * "credencial errada" de "voce tentou demais" — sao acoes diferentes para
     * quem esta na frente.
     */
    return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status })
  }

  const resposta = NextResponse.json(semToken(r.dados))
  resposta.cookies.set(SESSION_COOKIE, r.dados.token, opcoesDoCookie(DURACAO_DO_COOKIE_SEGUNDOS))
  return resposta
}

/**
 * Sair — NR-083, RF-119.
 *
 * ## Antes daqui, sair nao encerrava nada
 *
 * Este handler apagava o cookie e pronto. O token continuava VALIDO no servidor
 * pelas doze horas restantes: quem tivesse uma copia dele — navegador de balcao
 * compartilhado, aparelho emprestado — seguia dentro depois de a pessoa clicar
 * em "Sair". Nao dava para consertar antes: com o emissor de sessao em memoria,
 * o unico jeito de invalidar um token era reiniciar a api, o que invalidava
 * todos.
 *
 * ## O cookie e apagado mesmo se a api falhar
 *
 * Sair sempre da certo do ponto de vista de quem clicou. Se a chamada nao for,
 * o pior caso e o de antes — token vivo do lado do servidor —, e prender a
 * pessoa numa sessao que ela pediu para encerrar seria pior que isso.
 */
export async function DELETE() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value

  if (token !== undefined) {
    await chamarApi('/auth/logout', { method: 'POST', token })
  }

  const resposta = NextResponse.json({ ok: true })
  /* `maxAge: 0` com as MESMAS opcoes: cookie apagado com path ou sameSite
     diferente do que foi escrito nao e apagado — fica um orfao que o navegador
     continua mandando. */
  resposta.cookies.set(SESSION_COOKIE, '', opcoesDoCookie(0))
  return resposta
}

/** Quem sou eu. Usado pelo shell ao abrir o painel. */
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value

  if (token === undefined) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Entre na sua conta para continuar.' } },
      { status: 401 },
    )
  }

  const r = await chamarApi<{
    userId: string
    activeCompanyId: string | null
    role: string | null
  }>('/auth/me', { token })

  if (!r.ok) {
    const resposta = NextResponse.json(
      { error: { code: r.code, message: r.message } },
      { status: r.status },
    )
    /* Token recusado pela api: apaga o cookie. Sem isto a pessoa fica presa
       num laco — o proxy ve o cookie e deixa passar, a tela recebe 401. */
    if (r.status === 401) resposta.cookies.set(SESSION_COOKIE, '', opcoesDoCookie(0))
    return resposta
  }

  return NextResponse.json(r.dados)
}

/** O token e o unico campo que nao pode voltar para o navegador. */
function semToken(sessao: SessaoDaApi): Omit<SessaoDaApi, 'token'> {
  const resto: Partial<SessaoDaApi> = { ...sessao }
  delete resto.token
  return resto as Omit<SessaoDaApi, 'token'>
}
