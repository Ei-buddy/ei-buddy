import type { SubscriptionStatus } from '@na-regua/contracts'
import type { ExecutionContext } from '../context.js'
import type { SubscriptionRepository } from '../ports/subscription-repository.js'
import { avancar, deveAvisarDoFimDoTeste, type PoliticaDeAssinatura } from './estado.js'

export type SweepSubscriptionDeps = {
  readonly subscriptions: SubscriptionRepository
  readonly politica: PoliticaDeAssinatura
}

export type ResultadoDaVarredura = {
  /** `null` quando a empresa nao tem assinatura — estado normal e comum. */
  readonly status: SubscriptionStatus | null
  readonly mudou: boolean
  readonly motivo: string
  /** Hora de avisar que o teste esta acabando — RF-111. */
  readonly avisarDoFimDoTeste: boolean
}

/**
 * O tempo passando sobre UMA assinatura — RF-111, RF-117.
 *
 * Uma empresa por chamada, de proposito: quem percorre os tenants e o
 * consumidor do worker, com `list_company_ids()`, e cada passada entra por
 * `withTenant`. Assim toda ESCRITA desta varredura continua sob RLS — nao ha
 * caminho aqui que grave dado de tenant sem tenant no contexto.
 *
 * ## A decisao nao mora aqui
 *
 * Quem decide o proximo estado e `avancar`, que e puro e testado estado a
 * estado. Este caso de uso e a ponte: le, pergunta, grava o que mudou. Um
 * `if` de regra aqui seria a segunda resposta para "esta loja esta
 * bloqueada?".
 *
 * ## Idempotente por construcao
 *
 * Rodar duas vezes no mesmo dia nao muda nada na segunda: `avancar` devolve
 * `mudou: false` quando o estado ja e o que deveria ser. Varredura que nao
 * suporta ser repetida e varredura que ninguem pode reexecutar depois de uma
 * falha no meio.
 *
 * ## O relogio, e o cuidado com o dia
 *
 * `hoje` sai de `ctx.now`, em UTC. O prazo do lojista e um DIA de calendario, e
 * entre 21h e meia-noite em Brasilia o UTC ja virou — uma varredura naquele
 * intervalo restringiria a loja um dia antes do combinado. **O agendamento
 * deste job precisa cair entre 03h e 21h de Brasilia**, e e por isso que o
 * relogio entra por parametro em vez de ser lido aqui dentro.
 */
export async function sweepSubscription(
  deps: SweepSubscriptionDeps,
  ctx: ExecutionContext,
): Promise<ResultadoDaVarredura> {
  const assinatura = await deps.subscriptions.findByCompany(ctx.companyId)

  if (assinatura === undefined) {
    return {
      status: null,
      mudou: false,
      motivo: 'Empresa sem assinatura.',
      avisarDoFimDoTeste: false,
    }
  }

  const hoje = ctx.now.toISOString().slice(0, 10)

  const transicao = avancar(
    {
      status: assinatura.status,
      fimDoTeste: assinatura.trialEndsAt === null ? null : assinatura.trialEndsAt.slice(0, 10),
      proximoVencimento: assinatura.nextDueDate,
    },
    { tipo: 'tempo_passou', hoje },
    deps.politica,
  )

  if (transicao.mudou) {
    await deps.subscriptions.updateStatus({
      companyId: ctx.companyId,
      status: transicao.status,
      /*
       * A passagem do tempo so leva a `restricted` — nunca a `cancelled`, que
       * e ato do lojista. Por isso `cancelledAt` vai nulo aqui: a varredura
       * nao tem por que preservar nem inventar uma data de encerramento.
       */
      restrictedAt: transicao.status === 'restricted' ? ctx.now : null,
      cancelledAt: null,
      updatedAt: ctx.now,
    })
  }

  return {
    status: transicao.status,
    mudou: transicao.mudou,
    motivo: transicao.motivo,
    /*
     * So avisa quem CONTINUA em teste. Depois da transicao para `restricted`
     * a mensagem e outra — "seu teste acabou", nao "esta acabando" —, e mandar
     * as duas no mesmo dia e o lojista recebendo um aviso que ja nao vale.
     */
    avisarDoFimDoTeste:
      transicao.status === 'trial' &&
      deveAvisarDoFimDoTeste(
        assinatura.trialEndsAt === null ? null : assinatura.trialEndsAt.slice(0, 10),
        hoje,
        deps.politica,
      ),
  }
}
