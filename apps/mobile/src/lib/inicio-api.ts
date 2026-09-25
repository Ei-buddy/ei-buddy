import { chamarApi } from './api'
import { dataPorExtenso, hojeLocal, primeiroNome, saudacaoDaHora } from './periodo'

/**
 * O que a tela inicial mostra — NR-013.
 *
 * ## O que este modulo substitui
 *
 * A tela abria com `const HOJE = '2026-08-24'` escrito no codigo e somava
 * `lib/mock-data`. Ou seja: o app estava congelado num dia de agosto, e o
 * "vendido hoje" era o de uma loja inventada. Quem instalasse e vendesse
 * continuaria vendo os mesmos numeros.
 *
 * ## Falha parcial nao apaga a tela
 *
 * Sao quatro leituras independentes, e cada uma responde uma pergunta diferente.
 * Se a de contas a pagar cair, nao ha motivo para esconder o faturamento — o
 * bloco simplesmente nao aparece. Numa rede de celular isso e o caso comum, e
 * uma tela que some inteira por causa de um bloco e uma tela que o lojista
 * aprende a nao confiar.
 */

export type ResumoDoDia = {
  /** Nulo enquanto carrega; nunca zero como disfarce. */
  readonly faturamentoCents: number | null
  readonly vendasHoje: number | null
  readonly aPagarCents: number | null
  readonly contasVencidas: number | null
  readonly produtosParaRepor: number | null
  readonly produtosEsgotados: number | null
}

export type Saudacao = {
  readonly texto: string
  readonly nome: string | null
  readonly loja: string | null
  readonly data: string
}

type Perfil = { userName: string; companyName: string | null }
type Faturamento = { months: { grossCents: number; salesCount: number }[] }
type ResumoCatalogo = { belowMinimum: number; outOfStock: number }
export type ContaAPagar = {
  id: string
  supplier: string
  description: string
  amountCents: number
  settledAmountCents: number
  dueDate: string
}

type Contas = {
  totalCents: number
  temVencidas: boolean
  grupos: { faixa: string; payables: ContaAPagar[]; totalCents: number }[]
}

export type ProdutoParaRepor = {
  id: string
  description: string
  stock: number
  minStock: number
}

export type VendaRecente = {
  id: string
  number: number
  customerName: string | null
  /* O valor da venda e o bruto menos desconto; `netAmountCents` e o liquido. */
  grossAmountCents: number
  discountCents: number
}

export async function carregarSaudacao(agora: Date = new Date()): Promise<Saudacao> {
  const r = await chamarApi<Perfil>('/auth/perfil')

  return {
    texto: saudacaoDaHora(agora),
    nome: r.ok ? primeiroNome(r.dados.userName) : null,
    loja: r.ok ? r.dados.companyName : null,
    data: dataPorExtenso(agora),
  }
}

export async function carregarResumoDoDia(agora: Date = new Date()): Promise<ResumoDoDia> {
  const hoje = hojeLocal(agora)

  const [faturamento, catalogo, contas] = await Promise.all([
    chamarApi<Faturamento>(`/relatorios/faturamento?from=${hoje}&to=${hoje}`),
    chamarApi<ResumoCatalogo>('/produtos/resumo'),
    chamarApi<Contas>('/contas-a-pagar'),
  ])

  /*
   * O periodo de um dia so devolve um mes na serie, e o numero dele e o do
   * DIA pedido — o filtro do servidor e por data, e nao por mes inteiro.
   */
  const doDia = faturamento.ok ? faturamento.dados.months[0] : undefined

  const vencidas = contas.ok
    ? (contas.dados.grupos.find((g) => g.faixa === 'overdue')?.payables.length ?? 0)
    : null

  return {
    /* O bruto: o que os clientes pagaram. O liquido ja vem sem imposto e tarifa. */
    faturamentoCents: doDia?.grossCents ?? (faturamento.ok ? 0 : null),
    vendasHoje: doDia?.salesCount ?? (faturamento.ok ? 0 : null),
    aPagarCents: contas.ok ? contas.dados.totalCents : null,
    contasVencidas: vencidas,
    produtosParaRepor: catalogo.ok
      ? /* Menos os esgotados: as duas contagens do resumo se sobrepoem de
           proposito, e somar faria o lojista contar o mesmo produto duas vezes
           ao repor. */
        Math.max(0, catalogo.dados.belowMinimum - catalogo.dados.outOfStock)
      : null,
    produtosEsgotados: catalogo.ok ? catalogo.dados.outOfStock : null,
  }
}

/**
 * As listas dos blocos, cada uma da sua rota.
 *
 * Devolvem `null` quando a leitura falha, e nao lista vazia: vazio significa
 * "nao ha nada", e a tela diz isso ao lojista. Confundir os dois faria uma
 * queda de rede parecer uma loja sem contas a pagar.
 */
export async function carregarContasAPagar(): Promise<{
  readonly contas: readonly ContaAPagar[] | null
  readonly totalCents: number
  readonly vencidas: number
}> {
  const r = await chamarApi<Contas>('/contas-a-pagar')
  if (!r.ok) return { contas: null, totalCents: 0, vencidas: 0 }

  /* Na ordem dos grupos, que ja vem do servidor por urgencia: vencidas
     primeiro, depois hoje, semana, mes. E a ordem em que o lojista age. */
  const contas = r.dados.grupos.flatMap((g) => g.payables)

  return {
    contas,
    totalCents: r.dados.totalCents,
    vencidas: r.dados.grupos.find((g) => g.faixa === 'overdue')?.payables.length ?? 0,
  }
}

export async function carregarParaRepor(): Promise<readonly ProdutoParaRepor[] | null> {
  const r = await chamarApi<{ products: ProdutoParaRepor[] }>(
    '/produtos/catalogo?stock=baixo&pageSize=10',
  )
  return r.ok ? r.dados.products : null
}

export async function carregarVendasRecentes(): Promise<readonly VendaRecente[] | null> {
  const r = await chamarApi<{ sales: VendaRecente[] }>('/sales?pageSize=5')
  return r.ok ? r.dados.sales : null
}
