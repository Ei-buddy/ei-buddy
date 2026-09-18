import { purgeConversationHistory } from '@na-regua/core'
import type { ConsumerDeps, ResultadoDoJob } from './types.js'

/**
 * Expurgo de corpos de conversa com mais de 30 dias — RNF-035, NR-062 US5.
 *
 * Payload irrelevante: o gatilho e o agendamento, nao o conteudo. Percorre
 * os tenants, monta `ExecutionContext` de job com `deps.now()` injetado e
 * chama o caso de uso. Segunda corrida no mesmo `now` apaga zero.
 *
 * Nao instancia `Worker` do BullMQ — o `index.ts` cuida da fila.
 */
export async function consumirExpurgo(deps: ConsumerDeps): Promise<ResultadoDoJob> {
  const tenants = await deps.listTenantIds()
  let messagesDeleted = 0
  let conversationsClosed = 0

  for (const tenantId of tenants) {
    const r = await purgeConversationHistory(
      { conversations: deps.conversations },
      {
        companyId: tenantId,
        userId: 'job',
        role: 'owner',
        channel: 'job',
        requestId: 'conversation-purge',
        now: deps.now(),
      },
    )
    messagesDeleted += r.messagesDeleted
    conversationsClosed += r.conversationsClosed
  }

  return {
    outcome: 'purged',
    detalhes: { messagesDeleted, conversationsClosed },
  }
}
