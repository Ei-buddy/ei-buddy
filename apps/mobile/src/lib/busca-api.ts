import { chamarApi } from './api'

/**
 * A busca global do app — NR-162, a mesma do web (`lib/busca-api`): produto,
 * cliente e venda, contra os mesmos endpoints, poucos de cada.
 */

export type TipoDeResultado = 'produto' | 'cliente' | 'venda'

export type ResultadoDaBusca = {
  readonly tipo: TipoDeResultado
  readonly id: string
  readonly titulo: string
  /** Linha de apoio: codigo, documento, data. */
  readonly apoio: string
  /** Para onde o toque leva, ja com os parametros da tela. */
  readonly rota: { pathname: string; params: Record<string, string> }
}

const POR_TIPO = 4

/** Uma letra casa com quase tudo — e gasta tres consultas a cada tecla. */
export const MINIMO_DA_BUSCA = 2

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const dia = (iso: string) => {
  const [ano, mes, d] = iso.slice(0, 10).split('-')
  return `${d}/${mes}/${ano}`
}

export async function buscarTudo(termo: string): Promise<ResultadoDaBusca[]> {
  const q = encodeURIComponent(termo.trim())

  const [produtos, clientes, vendas] = await Promise.all([
    chamarApi<{
      products: { id: string; description: string; internalCode: string; salePriceCents: number }[]
    }>(`/produtos/catalogo?q=${q}&pageSize=${POR_TIPO}`),
    chamarApi<{
      customers: {
        id: string
        name: string
        tradeName?: string | null
        document: string | null
        phone: string | null
      }[]
    }>(`/clientes?q=${q}`),
    chamarApi<{
      sales: {
        id: string
        number: number
        soldAt: string
        customerName: string | null
        grossAmountCents: number
        discountCents: number
      }[]
    }>(`/sales?q=${q}&pageSize=${POR_TIPO}`),
  ])

  const achados: ResultadoDaBusca[] = []

  if (produtos.ok) {
    for (const p of produtos.dados.products.slice(0, POR_TIPO)) {
      achados.push({
        tipo: 'produto',
        id: p.id,
        titulo: p.description,
        apoio: `${p.internalCode} · ${reais(p.salePriceCents)}`,
        rota: { pathname: '/produto', params: { id: p.id } },
      })
    }
  }

  if (clientes.ok) {
    for (const c of clientes.dados.customers.slice(0, POR_TIPO)) {
      achados.push({
        tipo: 'cliente',
        id: c.id,
        titulo: c.tradeName ?? c.name,
        apoio: c.document ?? c.phone ?? 'sem documento',
        rota: { pathname: '/cliente', params: { id: c.id } },
      })
    }
  }

  if (vendas.ok) {
    for (const v of vendas.dados.sales.slice(0, POR_TIPO)) {
      achados.push({
        tipo: 'venda',
        id: v.id,
        titulo: `Venda #${v.number}`,
        apoio: `${dia(v.soldAt)} · ${v.customerName ?? 'balcão'} · ${reais(v.grossAmountCents - v.discountCents)}`,
        /* O historico abre ja filtrado pelo numero, com a venda a vista. */
        rota: { pathname: '/vendas', params: { q: String(v.number) } },
      })
    }
  }

  return achados
}
