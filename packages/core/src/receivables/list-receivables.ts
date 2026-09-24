import { PREFIXO_RECEBIVEL_DE_CARTAO } from '../sales/register-sale.js'
import type { ReceivableOutput } from '@na-regua/contracts'
import { type FaixaDeVencimento, faixaDeVencimento } from '@na-regua/domain'
import type { ExecutionContext } from '../context.js'
import type { ReceivableQueries } from '../ports/receivable-repository.js'

export type ListReceivablesDeps = { readonly receivables: ReceivableQueries }

export type GrupoDeRecebimento = {
  readonly faixa: FaixaDeVencimento
  readonly receivables: readonly ReceivableOutput[]
  /** Soma do que AINDA falta receber, nao do valor original. */
  readonly totalCents: number
}

export type ReceivablesAgrupadas = {
  readonly grupos: readonly GrupoDeRecebimento[]
  /** Total em aberto, somando todos os grupos. */
  readonly totalCents: number
  /**
   * Ha recebivel vencido — o que exige acao hoje.
   *
   * Campo proprio, como em `listPayables`, e nao "procure o grupo overdue e
   * veja se tem item": a tela de abertura pergunta uma coisa so, e obriga-la a
   * percorrer a estrutura convida cada tela a responder de um jeito.
   */
  readonly temVencidas: boolean
}

/** A ordem em que o lojista quer ver, e nao a alfabetica. */
const ORDEM: readonly FaixaDeVencimento[] = ['overdue', 'today', 'week', 'month', 'later']

/**
 * Contas a receber agrupadas por vencimento — RF-064, RF-066.
 *
 * Mesma forma de `listPayables`, e de proposito: as duas telas sao a mesma
 * estrutura com a contraparte trocada, e formas diferentes fariam o total
 * significar uma coisa numa e outra na outra.
 *
 * Leitura: nao passa por `assertCanWrite`. `accountant` e somente leitura, e e
 * quem mais consulta esta lista.
 *
 * So o que esta em aberto. Recebivel ja recebido nao pertence a "o que entra
 * esta semana", e cancelado nao pertence a lugar nenhum.
 */
export async function listReceivables(
  deps: ListReceivablesDeps,
  ctx: ExecutionContext,
  /** So os do cliente — a ficha do cliente mostra as pendencias dele (RF-072). */
  filtro: { readonly customerId?: string } = {},
): Promise<ReceivablesAgrupadas> {
  const lidos = await deps.receivables.list(ctx.companyId, {
    status: ['open', 'partially_settled'],
    ...(filtro.customerId === undefined ? {} : { customerId: filtro.customerId }),
  })

  /* Na visao do CLIENTE, parcela de cartao nao e divida dele: quem paga e a
     operadora. Na lista geral da loja ela continua, porque e dinheiro a entrar. */
  const abertos =
    filtro.customerId === undefined
      ? lidos
      : lidos.filter((r) => !r.description.startsWith(PREFIXO_RECEBIVEL_DE_CARTAO))

  /*
   * O dia de hoje sai de `ctx.now`, que e UTC. O fuso da empresa ainda nao
   * existe no contexto — quando existir, e aqui que ele se aplica, e o efeito
   * e real: as 21h de Brasilia ja e o dia seguinte em UTC, e um recebivel que
   * vence amanha apareceria como vencendo hoje.
   */
  const hoje = ctx.now.toISOString().slice(0, 10)

  const porFaixa = new Map<FaixaDeVencimento, ReceivableOutput[]>(ORDEM.map((f) => [f, []]))
  for (const r of abertos) {
    porFaixa.get(faixaDeVencimento(r.dueDate, hoje))!.push(r)
  }

  const grupos = ORDEM.map((faixa) => {
    const receivables = porFaixa
      .get(faixa)!
      /* Dentro do grupo, o que vence antes vem antes. */
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    return { faixa, receivables, totalCents: somarEmAberto(receivables) }
  })

  return {
    grupos,
    totalCents: grupos.reduce((soma, g) => soma + g.totalCents, 0),
    temVencidas: grupos.find((g) => g.faixa === 'overdue')!.receivables.length > 0,
  }
}

/**
 * O que falta receber, e sobre o BRUTO.
 *
 * `amountCents` e nao `netAmountCents`: a baixa abate do valor devido pelo
 * cliente, e e esse que ele paga. O liquido e o que sobra depois da tarifa da
 * adquirente, e serve para prever caixa — usa-lo aqui faria a conta de mil
 * reais parecer quitada com novecentos e setenta recebidos.
 */
function somarEmAberto(receivables: readonly ReceivableOutput[]): number {
  return receivables.reduce((soma, r) => soma + (r.amountCents - r.settledAmountCents), 0)
}
