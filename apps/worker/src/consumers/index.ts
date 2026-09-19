import { QUEUES, type QueueName } from '../queues.js'
import { consumirCobranca } from './charge-overdue.js'
import { consumirExpurgo } from './conversation-purge.js'
import { consumirVarreduraDeAssinatura } from './subscription-sweep.js'
import { consumirEmissao } from './invoice-issue.js'
import type { ConsumerDeps, ResultadoDoJob } from './types.js'
import { consumirEnvio } from './whatsapp-send.js'

export type Consumidor = (deps: ConsumerDeps, payload: unknown) => Promise<ResultadoDoJob>

/**
 * Qual consumidor atende qual fila — NR-041.
 *
 * `Partial` de proposito: `bank-sync` (NR-047) e `webhook-process` (NR-046)
 * ainda nao tem consumidor. O tipo diz isso em vez de esconder, e `consumidorDe`
 * devolve `undefined` para elas — o worker registra que recebeu e nao finge que
 * processou.
 *
 * A alternativa seria deixar as filas fora do registro e cair num `default` que
 * trata tudo igual. Ai o dia em que alguem cria uma fila nova e esquece o
 * consumidor e um dia em que jobs somem em silencio.
 */
const CONSUMIDORES: Partial<Record<QueueName, Consumidor>> = {
  [QUEUES.invoiceIssue]: consumirEmissao,
  [QUEUES.whatsappSend]: consumirEnvio,
  /* A varredura ignora o payload: o gatilho e o agendamento, nao o conteudo. */
  [QUEUES.chargeOverdue]: (deps) => consumirCobranca(deps),
  [QUEUES.conversationPurge]: (deps) => consumirExpurgo(deps),
  [QUEUES.subscriptionSweep]: (deps) => consumirVarreduraDeAssinatura(deps),
}

export function consumidorDe(fila: QueueName): Consumidor | undefined {
  return CONSUMIDORES[fila]
}

/** As filas que ainda esperam consumidor — usado no log de inicializacao. */
export function filasSemConsumidor(): readonly QueueName[] {
  return Object.values(QUEUES).filter((f) => CONSUMIDORES[f] === undefined)
}

export {
  consumirCobranca,
  consumirEmissao,
  consumirEnvio,
  consumirExpurgo,
  consumirVarreduraDeAssinatura,
}
export type { ConsumerDeps, ResultadoDoJob } from './types.js'
