import type { SubscriptionEvent, SubscriptionStatus } from '@na-regua/contracts'
import type { SubscriptionRepository } from '../ports/subscription-repository.js'
import { avancar, type EventoDaAssinatura, type PoliticaDeAssinatura } from './estado.js'

export type HandleSubscriptionEventDeps = {
  readonly subscriptions: SubscriptionRepository
  readonly politica: PoliticaDeAssinatura
}

export type ResultadoDoEvento = {
  readonly status: SubscriptionStatus | null
  readonly mudou: boolean
  readonly motivo: string
}

/**
 * O aviso do provedor movendo a assinatura — RF-112, RF-113, RF-118.
 *
 * ## De qual loja o aviso fala
 *
 * De `externalReference`, que e o `company_id`. O aviso chega SEM contexto de
 * tenant — e um POST do provedor, nao uma requisicao de alguem logado —, e a
 * RLS recusa leitura sem tenant. Com o id da assinatura ali, descobrir a
 * empresa custaria uma consulta cross-tenant, ou seja, mais uma funcao
 * `SECURITY DEFINER`. O aviso carregar a propria empresa resolve isso sem
 * superficie privilegiada nenhuma.
 *
 * Aviso sem referencia nao e erro: o provedor manda eventos que nao apontam
 * para assinatura nossa (uma cobranca avulsa na conta-pai, por exemplo). Sao
 * ignorados, e nao rejeitados — 4xx faria o provedor reentregar para sempre.
 *
 * ## Reprocessar o mesmo aviso nao faz mal
 *
 * O provedor reentrega. `avancar` responde `mudou: false` quando o estado ja e
 * o que deveria ser, entao a segunda passada nao grava nem audita de novo. A
 * dedup por `webhook_events` continua valendo — ela evita o TRABALHO; esta
 * funcao evita o ESTRAGO, e as duas protecoes cobrem coisas diferentes.
 *
 * ## Sem `ExecutionContext`
 *
 * Nao ha usuario nem sessao: quem "agiu" foi o provedor. Fabricar um contexto
 * de tenant aqui seria inventar autoria — e o `companyId` que importa vem do
 * proprio aviso, nao de uma sessao que nao existe.
 */
export async function handleSubscriptionEvent(
  deps: HandleSubscriptionEventDeps,
  evento: SubscriptionEvent,
): Promise<ResultadoDoEvento> {
  const companyId = evento.externalReference

  if (companyId === null) {
    return { status: null, mudou: false, motivo: 'Aviso sem empresa associada.' }
  }

  const assinatura = await deps.subscriptions.findByCompany(companyId)

  if (assinatura === undefined) {
    /*
     * Aviso de uma empresa que nao tem assinatura nossa. Acontece em sandbox e
     * depois de um expurgo; lancar aqui faria o provedor reentregar o mesmo
     * aviso indefinidamente por causa de dado que nao existe mais.
     */
    return { status: null, mudou: false, motivo: 'Empresa sem assinatura.' }
  }

  const transicao = avancar(
    {
      status: assinatura.status,
      fimDoTeste: assinatura.trialEndsAt === null ? null : assinatura.trialEndsAt.slice(0, 10),
      proximoVencimento: assinatura.nextDueDate,
    },
    paraEventoDeDominio(evento.type),
    deps.politica,
  )

  if (transicao.mudou) {
    await deps.subscriptions.updateStatus({
      companyId,
      status: transicao.status,
      /*
       * Sair de `restricted` LIMPA a marca — RF-118. Sem isto, a loja voltaria
       * a funcionar com a tela ainda dizendo desde quando esta bloqueada.
       */
      restrictedAt: null,
      cancelledAt: transicao.status === 'cancelled' ? new Date(evento.occurredAt) : null,
      updatedAt: new Date(evento.occurredAt),
    })
  }

  return transicao
}

/**
 * O vocabulario do provedor para o nosso.
 *
 * Exaustivo de proposito: um `default` aqui engoliria um tipo novo do
 * contrato em silencio, e o compilador e quem deve cobrar a traducao.
 */
function paraEventoDeDominio(tipo: SubscriptionEvent['type']): EventoDaAssinatura {
  switch (tipo) {
    case 'subscription.paid':
      return { tipo: 'pago' }
    case 'subscription.payment_failed':
      return { tipo: 'pagamento_recusado' }
    case 'subscription.cancelled':
      return { tipo: 'cancelado' }
  }
}
