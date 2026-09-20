import type { WebhookInbox } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Caixa de entrada de webhooks — NR-063, RNF-028.
 *
 * Nenhuma migration: `webhook_events` existe desde a `0007`, com a unicidade
 * `(provider, event_id)` que decide a dedup.
 *
 * ## Por que `withTenant`, se o INSERT poderia ser sem tenant
 *
 * A politica da tabela e incomum de proposito: `WITH CHECK (true)` deixa
 * gravar antes de saber a empresa, e o `USING` filtra a LEITURA. Isso existe
 * para o caso em que o aviso chega sem dar para saber de quem e.
 *
 * Aqui da para saber: o `externalReference` do nosso desenho E o `company_id`.
 * E gravar com tenant nao e so capricho — e o que faz o `RETURNING` funcionar.
 * Num `INSERT ... RETURNING`, o Postgres aplica a politica de SELECT sobre a
 * linha devolvida: sem `app.company_id` no contexto, o `USING` filtraria a
 * propria linha recem-inserida e o retorno viria vazio. Vazio e exatamente o
 * que significa "ja existia" — entao TODO aviso pareceria repetido, e nenhum
 * seria processado.
 */
export function createWebhookInbox(sql: Sql): WebhookInbox {
  return {
    registrar: async (entrada) => {
      const linhas = await withTenant(
        sql,
        entrada.companyId,
        (tx) => tx<{ id: string }[]>`
          INSERT INTO webhook_events (provider, event_id, company_id, payload, received_at)
          VALUES (
            ${entrada.provider},
            ${entrada.eventId},
            ${entrada.companyId},
            ${tx.json(entrada.payload as never)},
            ${entrada.receivedAt}
          )
          /* A dedup e do BANCO. Um SELECT antes do INSERT daria falso negativo
             sob reentrega simultanea — e o provedor reentrega em paralelo
             quando a primeira resposta demora. */
          ON CONFLICT (provider, event_id) DO NOTHING
          RETURNING id
        `,
      )

      /* Linha devolvida = insercao nova. Nenhuma = o conflito venceu, ou seja,
         o aviso ja tinha chegado. */
      return linhas.length > 0
    },

    marcarProcessado: async (entrada) => {
      await withTenant(
        sql,
        entrada.companyId,
        (tx) => tx`
          UPDATE webhook_events
             SET processed_at = ${entrada.processedAt}
           WHERE provider = ${entrada.provider}
             AND event_id = ${entrada.eventId}
        `,
      )
    },
  }
}
