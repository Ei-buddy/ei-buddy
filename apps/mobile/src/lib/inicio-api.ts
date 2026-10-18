import { chamarApi } from './api'
import { diaLocal } from './format'
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
  /** O mesmo dia depois de desconto, imposto e taxa de cartao. */
  readonly liquidoCents: number | null
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
type Faturamento = { months: { grossCents: number; netCents: number; salesCount: number }[] }
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
    liquidoCents: doDia?.netCents ?? (faturamento.ok ? 0 : null),
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

/* -------------------------------------------------------------------------- */
/* O que o painel do web tambem mostra — NR-161                               */
/* -------------------------------------------------------------------------- */

type ResumoDeVendas = {
  salesCount: number
  grossCents: number
  netCents: number
  averageTicketCents: number | null
}

export type DiaDaSemana = {
  readonly dia: string
  /** Rotulo curto: "seg", "ter". */
  readonly rotulo: string
  /** Faturamento do dia: o bruto, como no web. */
  readonly grossCents: number
  readonly salesCount: number
}

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const

/**
 * Os sete dias ate hoje, com o resumo de cada um — o grafico "Vendas na
 * semana" e o ticket medio do dia, iguais aos do painel do web.
 *
 * Uma chamada por DIA, como no web: o `summary` do `/sales` e do periodo
 * filtrado (calculado antes do LIMIT), e um pedido so para a semana
 * truncaria numa loja com muitas vendas. Tudo ou nada: uma barra faltando
 * pareceria um dia sem venda.
 */
export async function carregarSemana(
  agora: Date = new Date(),
): Promise<{ dias: readonly DiaDaSemana[]; hoje: ResumoDeVendas } | null> {
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(agora)
    d.setDate(d.getDate() - (6 - i))
    return d
  })
  const respostas = await Promise.all(
    dias.map((d) => {
      const dia = diaLocal(d)
      return chamarApi<{ summary: ResumoDeVendas }>(`/sales?from=${dia}&to=${dia}&pageSize=1`)
    }),
  )
  if (!respostas.every((r) => r.ok)) return null
  const resumos = respostas.map((r) => (r.ok ? r.dados.summary : null)!)
  return {
    dias: resumos.map((s, i) => ({
      dia: diaLocal(dias[i]!),
      rotulo: DIAS_CURTOS[dias[i]!.getDay()]!,
      grossCents: s.grossCents,
      salesCount: s.salesCount,
    })),
    hoje: resumos[6]!,
  }
}

/** Total em aberto a receber — o indicador "A receber" do web. */
export async function carregarAReceber(): Promise<number | null> {
  const r = await chamarApi<{ totalCents: number }>('/contas-a-receber')
  return r.ok ? r.dados.totalCents : null
}

/** Quantos produtos e clientes a loja tem — alimenta os "Primeiros passos". */
export async function carregarTotaisDoCadastro(): Promise<{
  produtos: number | null
  clientes: number | null
}> {
  const [produtos, clientes] = await Promise.all([
    chamarApi<{ total: number }>('/produtos/resumo'),
    chamarApi<{ total: number }>('/clientes?pageSize=1'),
  ])
  return {
    produtos: produtos.ok ? produtos.dados.total : null,
    clientes: clientes.ok ? clientes.dados.total : null,
  }
}
