import { NextResponse, type NextRequest } from 'next/server'
import { encaminharArquivo } from '@/lib/bff'

/**
 * Exportar listas em CSV ou PDF — NR-155. Uma rota so para todas: o nome da
 * lista escolhe o caminho na api, e os filtros da tela viajam como vieram.
 * Lista fora do mapa e 404 — o BFF nao vira proxy de qualquer caminho.
 */
const CAMINHOS: Record<string, string> = {
  clientes: '/clientes/exportar',
  produtos: '/produtos/exportar',
  vendas: '/sales/exportar',
  faturamento: '/relatorios/faturamento/exportar',
  'ranking-clientes': '/relatorios/ranking/clientes/exportar',
  'ranking-produtos': '/relatorios/ranking/produtos/exportar',
  dre: '/relatorios/dre/exportar',
}

export async function GET(request: NextRequest, ctx: RouteContext<'/api/exportar/[lista]'>) {
  const { lista } = await ctx.params
  const caminho = CAMINHOS[lista]
  if (caminho === undefined) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Lista desconhecida.' } },
      { status: 404 },
    )
  }

  const query = new URLSearchParams()
  for (const [chave, valor] of request.nextUrl.searchParams) {
    if (valor !== '') query.set(chave, valor)
  }

  return encaminharArquivo(`${caminho}?${query.toString()}`)
}
