import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** A fila de chamados de todas as lojas — NR-215. So viaja o filtro que veio. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query = new URLSearchParams()
  for (const chave of ['situation', 'page', 'pageSize']) {
    const valor = searchParams.get(chave)
    if (valor !== null && valor !== '') query.set(chave, valor)
  }
  const resto = query.toString()
  return encaminhar(resto === '' ? '/admin/chamados' : `/admin/chamados?${resto}`)
}
