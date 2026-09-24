import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/**
 * O historico de vendas — NR-027, US-021.
 *
 * Rota propria em vez de `GET /api/vendas`: aquele caminho ja e o POST do
 * fechamento, e um GET no mesmo lugar misturaria a escrita transacional com a
 * leitura paginada. Sao contratos diferentes.
 *
 * Os parametros so viajam quando vieram. Mandar `from=` vazio faria a api
 * validar string vazia como data e recusar o pedido inteiro, quando a intencao
 * era nao filtrar por periodo.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  const query = new URLSearchParams()
  for (const chave of ['from', 'to', 'q', 'customerId', 'page', 'pageSize']) {
    const valor = searchParams.get(chave)
    if (valor !== null && valor !== '') query.set(chave, valor)
  }

  return encaminhar(`/sales?${query.toString()}`)
}
