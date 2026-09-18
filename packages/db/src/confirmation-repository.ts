import type { ConfirmationDecision, ConfirmationStore, PendingConfirmation } from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Store Postgres da pendencia de acao sensivel — NR-061, US2 + US5.
 *
 * Porta em `core`; so `apps/api/src/composition.ts` instancia. `agent` nao
 * importa este modulo. Todo metodo passa por `withTenant`: o tenant e o
 * `companyId` da assinatura (contexto), nunca o UUID embutido na chave se
 * divergir. Loja B le ausencia, nunca o payload da A.
 *
 * `resolve` NAO apaga (FR-011; CHECK da 0007). `getOpen` NAO filtra
 * `expires_at` — a expirada ainda aberta volta para o laço marcar `expired`.
 * `number_from` vazio recusa o `put` (fail-closed; UNIQUE com NULL nao impede
 * duplicata). Nao grava `messages` — historico e NR-062.
 */

type CanalDaIdentidade = 'app' | 'whatsapp'

type Identidade = {
  readonly channel: CanalDaIdentidade
  readonly numberFrom: string
}

type Payload = {
  readonly toolId: string
  readonly args: unknown
  readonly summary: string
  readonly conversationKey: string
}

type LinhaAberta = {
  id: string
  company_id: string
  action: string
  payload: Payload
  expires_at: Date
}

function identidadeDaChave(conversationKey: string): Identidade | undefined {
  const partes = conversationKey.split(':')
  if (partes.length < 3) return undefined
  const prefixo = partes[0]
  const numberFrom = partes.slice(2).join(':')
  if (prefixo === 'app') return { channel: 'app', numberFrom }
  if (prefixo === 'wa') return { channel: 'whatsapp', numberFrom }
  return undefined
}

function exigirIdentidade(conversationKey: string): Identidade {
  const identidade = identidadeDaChave(conversationKey)
  if (identidade === undefined || identidade.numberFrom.trim() === '') {
    throw new Error(
      'put recusou conversa sem interlocutor (number_from vazio). ' +
        'A identidade precisa de canal e peer/userId — fail-closed, NR-061.',
    )
  }
  return identidade
}

function paraPendencia(linha: LinhaAberta): PendingConfirmation {
  return {
    id: linha.id,
    companyId: linha.company_id,
    conversationKey: linha.payload.conversationKey,
    toolId: linha.action,
    args: linha.payload.args,
    summary: linha.payload.summary,
    expiresAt: linha.expires_at,
  }
}

async function upsertConversa(
  tx: TransactionSql,
  companyId: string,
  identidade: Identidade,
): Promise<string> {
  const [vigente] = await tx<{ id: string }[]>`
    SELECT id FROM conversations
     WHERE company_id = ${companyId}
       AND channel = ${identidade.channel}
       AND number_from = ${identidade.numberFrom}
       AND deleted_at IS NULL
  `
  if (vigente !== undefined) return vigente.id

  const [inserida] = await tx<{ id: string }[]>`
    INSERT INTO conversations (company_id, channel, number_from)
    VALUES (${companyId}, ${identidade.channel}, ${identidade.numberFrom})
    ON CONFLICT (company_id, channel, number_from) WHERE deleted_at IS NULL
      DO NOTHING
    RETURNING id
  `
  if (inserida !== undefined) return inserida.id

  const [corrida] = await tx<{ id: string }[]>`
    SELECT id FROM conversations
     WHERE company_id = ${companyId}
       AND channel = ${identidade.channel}
       AND number_from = ${identidade.numberFrom}
       AND deleted_at IS NULL
  `
  if (corrida === undefined) {
    throw new Error(
      'put nao conseguiu obter a identidade da conversa apos o upsert. ' +
        'A corrida no unico parcial deveria ter deixado uma row vigente.',
    )
  }
  return corrida.id
}

export function createConfirmationStore(sql: Sql): ConfirmationStore {
  return {
    put: async (pending) => {
      const identidade = exigirIdentidade(pending.conversationKey)
      const payload: Payload = {
        toolId: pending.toolId,
        args: pending.args,
        summary: pending.summary,
        conversationKey: pending.conversationKey,
      }

      await withTenant(sql, pending.companyId, async (tx) => {
        const conversationId = await upsertConversa(tx, pending.companyId, identidade)

        await tx`
          UPDATE confirmations
             SET resolved_at = now(),
                 decision = 'rejected'
           WHERE company_id = ${pending.companyId}
             AND conversation_id = ${conversationId}
             AND resolved_at IS NULL
        `

        await tx`
          INSERT INTO confirmations
            (id, company_id, conversation_id, action, payload, expires_at)
          VALUES (
            ${pending.id},
            ${pending.companyId},
            ${conversationId},
            ${pending.toolId},
            ${sql.json(payload)},
            ${pending.expiresAt}
          )
        `
      })
    },

    getOpen: async (companyId, conversationKey, _now) => {
      const identidade = identidadeDaChave(conversationKey)
      if (identidade === undefined || identidade.numberFrom.trim() === '') {
        return undefined
      }

      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaAberta[]>`
          SELECT c.id, c.company_id, c.action, c.payload, c.expires_at
            FROM confirmations c
            JOIN conversations v ON v.id = c.conversation_id
           WHERE c.company_id = ${companyId}
             AND v.channel = ${identidade.channel}
             AND v.number_from = ${identidade.numberFrom}
             AND v.deleted_at IS NULL
             AND c.resolved_at IS NULL
        `,
      )

      return linha === undefined ? undefined : paraPendencia(linha)
    },

    resolve: async (companyId, id, decision: ConfirmationDecision) => {
      /* Ja resolvida / id de outra loja / inexistente: o WHERE vira no-op. */
      await withTenant(
        sql,
        companyId,
        (tx) => tx`
          UPDATE confirmations
             SET resolved_at = now(),
                 decision = ${decision}
           WHERE id = ${id}
             AND company_id = ${companyId}
             AND resolved_at IS NULL
        `,
      )
    },
  }
}
