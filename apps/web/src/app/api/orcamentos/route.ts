import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/**
 * Orcamentos — NR-159. A lista leva busca, situacao, periodo e pagina
 * (NR-210); so viaja o parametro que veio preenchido.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query = new URLSearchParams()
  for (const chave of ['q', 'situation', 'from', 'to', 'page', 'pageSize']) {
    const valor = searchParams.get(chave)
    if (valor !== null && valor !== '') query.set(chave, valor)
  }
  const resto = query.toString()
  return encaminhar(resto === '' ? '/orcamentos' : `/orcamentos?${resto}`)
}

export async function POST(request: NextRequest) {
  return encaminhar('/orcamentos', { method: 'POST', body: await corpoDe(request) })
}
