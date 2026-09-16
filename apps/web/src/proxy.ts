import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'

/**
 * Protecao das rotas de `/app/*` (ADR-0007).
 *
 * No Next 16 o antigo Middleware passou a se chamar Proxy — mesma
 * funcionalidade, arquivo `src/proxy.ts`.
 *
 * IMPORTANTE: isto e uma checagem OTIMISTA de navegacao. Ela evita que uma
 * pessoa sem sessao caia numa tela do painel, mas NAO e autorizacao: cada
 * rota de API precisa validar a sessao por conta propria no servidor.
 *
 * O cookie e `httpOnly` (NR-013): so o servidor o escreve e o le. Aqui ainda
 * se confere apenas a PRESENCA, e continua sendo otimista de proposito —
 * validar assinatura e expiracao no proxy significaria falar com a api a cada
 * navegacao, inclusive nas que nem chegam a buscar dado.
 *
 * Quem valida de verdade e a api, em toda chamada. E quando ela recusa o token,
 * o Route Handler `/api/session` apaga o cookie — sem isso a pessoa ficaria
 * presa: o proxy veria o cookie e deixaria passar, e cada tela receberia 401.
 */
export function proxy(request: NextRequest) {
  const temSessao = Boolean(request.cookies.get(SESSION_COOKIE)?.value)

  if (temSessao) return NextResponse.next()

  /* Guarda o destino para devolver a pessoa a ela apos o login. */
  const login = new URL('/login', request.url)
  const destino = request.nextUrl.pathname + request.nextUrl.search
  login.searchParams.set('proximo', destino)

  return NextResponse.redirect(login)
}

export const config = {
  matcher: ['/app/:path*'],
}
