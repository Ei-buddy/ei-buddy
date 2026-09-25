import { pedir } from './http'

/**
 * A busca do topo — NR-013.
 *
 * O campo existia na barra e nao fazia nada: nem estado, nem handler. Digitar
 * nele era digitar num campo morto, o que e pior que nao ter campo — um campo
 * de busca visivel promete que ha o que buscar.
 *
 * ## Tres fontes, uma caixa
 *
 * Produto, cliente e venda. Sao as tres coisas que o lojista procura pelo nome,
 * e sao as tres que ja tem rota com busca no servidor. Quem digita "cafe" pode
 * querer o produto ou a venda em que ele saiu, e obrigar a escolher a tela
 * antes de procurar inverte a ordem: para escolher a tela, ele ja precisaria
 * saber o que vai achar.
 *
 * ## Falha parcial nao apaga o resto
 *
 * As tres em paralelo, e quem falhar simplesmente nao aparece. Uma queda na
 * consulta de vendas nao pode esconder o produto que a pessoa achou.
 */

export type TipoDeResultado = 'produto' | 'cliente' | 'venda'

export type Resultado = {
  readonly tipo: TipoDeResultado
  readonly id: string
  readonly titulo: string
  /** Linha de apoio: codigo, documento, data. */
  readonly apoio: string
  readonly href: string
}

/** Quantos de cada tipo. Poucos, porque a caixa e uma lista e nao uma tela. */
const POR_TIPO = 4

/**
 * Termo minimo para consultar.
 *
 * Uma letra casa com quase tudo e traz uma lista que nao ajuda ninguem — e
 * gasta tres consultas para isso a cada tecla.
 */
export const MINIMO_DA_BUSCA = 2

type ProdutoDaApi = {
  id: string
  description: string
  internalCode: string
  salePriceCents: number
}

type ClienteDaApi = {
  id: string
  name: string
  document: string | null
  phone: string | null
}

type VendaDaApi = {
  id: string
  number: number
  soldAt: string
  customerName: string | null
  grossAmountCents: number
  discountCents: number
}

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const dia = (iso: string) => {
  const [ano, mes, d] = iso.slice(0, 10).split('-')
  return `${d}/${mes}/${ano}`
}

export async function buscar(termo: string): Promise<Resultado[]> {
  const q = encodeURIComponent(termo.trim())

  const [produtos, clientes, vendas] = await Promise.all([
    pedir<{ products: ProdutoDaApi[] }>(`/api/produtos/catalogo?q=${q}&pageSize=${POR_TIPO}`),
    pedir<{ customers: ClienteDaApi[] }>(`/api/clientes?q=${q}`),
    pedir<{ sales: VendaDaApi[] }>(`/api/vendas/historico?q=${q}&pageSize=${POR_TIPO}`),
  ])

  const achados: Resultado[] = []

  if (produtos.ok) {
    for (const p of produtos.dados.products.slice(0, POR_TIPO)) {
      achados.push({
        tipo: 'produto',
        id: p.id,
        titulo: p.description,
        apoio: `${p.internalCode} · ${reais(p.salePriceCents)}`,
        href: `/app/produtos/${p.id}`,
      })
    }
  }

  if (clientes.ok) {
    for (const c of clientes.dados.customers.slice(0, POR_TIPO)) {
      achados.push({
        tipo: 'cliente',
        id: c.id,
        titulo: c.name,
        apoio: c.document ?? c.phone ?? 'sem documento',
        href: `/app/clientes/${c.id}`,
      })
    }
  }

  if (vendas.ok) {
    for (const v of vendas.dados.sales.slice(0, POR_TIPO)) {
      achados.push({
        tipo: 'venda',
        id: v.id,
        titulo: `Venda #${v.number}`,
        apoio: `${dia(v.soldAt)} · ${v.customerName ?? 'balcao'} · ${reais(v.grossAmountCents - v.discountCents)}`,
        href: `/app/vendas/${v.id}`,
      })
    }
  }

  return achados
}

export const ROTULO_DO_TIPO: Record<TipoDeResultado, string> = {
  produto: 'Produtos',
  cliente: 'Clientes',
  venda: 'Vendas',
}
