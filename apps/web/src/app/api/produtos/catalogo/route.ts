import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/**
 * O catalogo do backoffice, paginado — NR-072, US-008.
 *
 * Rota propria, e nao `?page=` em `/api/produtos`: aquela e a busca do balcao,
 * com teto de 50, e o PDV depende do formato dela.
 *
 * Os parametros sao repassados apenas quando VIERAM. Mandar `q=` ou `page=`
 * vazios faria a api validar string vazia como numero e recusar o pedido
 * inteiro, quando a intencao era usar o padrao dela.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  const query = new URLSearchParams()
  for (const chave of ['q', 'stock', 'situacao', 'page', 'pageSize']) {
    const valor = searchParams.get(chave)
    if (valor !== null && valor !== '') query.set(chave, valor)
  }

  return encaminhar(`/produtos/catalogo?${query.toString()}`)
}
