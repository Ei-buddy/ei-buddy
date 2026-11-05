import type { PayableOutput } from '@na-regua/contracts'
import { type FaixaDeVencimento, faixaDeVencimento } from '@na-regua/domain'
import type { ExecutionContext } from '../context.js'
import type { PayableQueries } from '../ports/payable-repository.js'

export type ListPayablesDeps = PayableQueries

export type GrupoDeVencimento = {
  readonly faixa: FaixaDeVencimento
  readonly payables: readonly PayableOutput[]
  /** Soma do que AINDA falta pagar, nao do valor original. */
  readonly totalCents: number
}

export type PayablesAgrupadas = {
  readonly grupos: readonly GrupoDeVencimento[]
  /** Total em aberto, somando todos os grupos. */
  readonly totalCents: number
  /**
   * Ha conta vencida — RF-062, o destaque na abertura do sistema.
   *
   * Campo proprio, e nao "procure o grupo overdue e veja se tem item": a tela
   * de abertura pergunta uma coisa so, e obriga-la a percorrer a estrutura para
   * descobrir isso convida cada tela a responder de um jeito.
   */
  readonly temVencidas: boolean
  /**
   * As quitadas mais recentes, da mais nova para a mais antiga — o filtro
   * "Pagos" da tela. Fora dos grupos e do total: grupo e total falam do que
   * AINDA falta pagar. Achado do QA: sem elas o filtro nunca mostrava nada.
   */
  readonly quitadas: readonly PayableOutput[]
}

/**
 * Quantas quitadas a lista leva. O historico de pagas so cresce; a tela quer
 * as recentes, e a consulta antiga cabe no relatorio e na exportacao.
 */
export const QUITADAS_NA_LISTA = 200

/** A ordem em que o lojista quer ver, e nao a alfabetica. */
const ORDEM: readonly FaixaDeVencimento[] = ['overdue', 'today', 'week', 'month', 'later']

/**
 * Contas a pagar agrupadas por vencimento, com total por grupo — RF-061, RF-062.
 *
 * Leitura: nao passa por `assertCanWrite`. `accountant` e somente leitura, e e
 * justamente quem mais consulta esta lista.
 *
 * Os grupos so tem o que esta em aberto. Conta paga nao pertence a "o que vence
 * esta semana" — ela vem a parte, em `quitadas` —, e cancelada nao pertence a
 * lugar nenhum.
 */
export async function listPayables(
  deps: ListPayablesDeps,
  ctx: ExecutionContext,
): Promise<PayablesAgrupadas> {
  const [abertas, quitadas] = await Promise.all([
    deps.list(ctx.companyId, { status: ['open', 'partially_settled'] }),
    deps.list(ctx.companyId, { status: ['settled'], maisRecentes: QUITADAS_NA_LISTA }),
  ])

  /*
   * O dia de hoje sai de `ctx.now`, que e UTC. O fuso da empresa ainda nao
   * existe no contexto — quando existir, e aqui que ele se aplica, e o efeito
   * e real: as 21h de Brasilia ja e o dia seguinte em UTC, e uma conta que
   * vence amanha apareceria como vencendo hoje.
   */
  const hoje = ctx.now.toISOString().slice(0, 10)

  const porFaixa = new Map<FaixaDeVencimento, PayableOutput[]>(ORDEM.map((f) => [f, []]))
  for (const conta of abertas) {
    porFaixa.get(faixaDeVencimento(conta.dueDate, hoje))!.push(conta)
  }

  const grupos = ORDEM.map((faixa) => {
    const payables = porFaixa
      .get(faixa)!
      /* Dentro do grupo, o que vence antes vem antes. */
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    return { faixa, payables, totalCents: somarEmAberto(payables) }
  })

  return {
    grupos,
    totalCents: grupos.reduce((soma, g) => soma + g.totalCents, 0),
    temVencidas: grupos.find((g) => g.faixa === 'overdue')!.payables.length > 0,
    quitadas,
  }
}

/**
 * O que falta pagar, e nao o valor original.
 *
 * Numa conta de mil reais com seiscentos ja pagos, o total do grupo tem de
 * dizer quatrocentos — e o numero que responde "quanto preciso ter em caixa
 * esta semana", que e a pergunta que faz alguem abrir essa tela.
 */
function somarEmAberto(payables: readonly PayableOutput[]): number {
  return payables.reduce((soma, p) => soma + (p.amountCents - p.settledAmountCents), 0)
}
