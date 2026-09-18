import type {
  ActiveContext,
  ConversationPurgeRepository,
  ConversationStore,
  StoredMessage,
} from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { parseConversationKey, upsertConversationIdentity } from './conversation-identity.js'
import { withTenant } from './tenant.js'

/** Idle padrao: 2 h. Nao apaga mensagens; so corta o recorte do decide. */
const IDLE_PADRAO_MS = 7_200_000
/** Default `window = 12` (RNF-075 / ADR-0016). LIMIT do SELECT vigente, nao DELETE. */
const JANELA_PADRAO = 12

type LinhaMensagem = {
  id: string
  role: StoredMessage['role']
  body: string
  tool_calls: unknown
  created_at: Date
}

/**
 * Store Postgres do historico — NR-062 US2.
 *
 * Toda leitura/escrita passa por `withTenant`: o `companyId` da assinatura e
 * o tenant. UUID dentro da `conversationKey` que divergir perde. Loja B na
 * chave da A e ausencia (`undefined`), nunca o corpo.
 */
export function createConversationStore(sql: Sql): ConversationStore {
  return {
    loadActive: async (companyId, conversationKey, now, options) => {
      const identidade = parseConversationKey(conversationKey)
      if (identidade === undefined) return undefined

      const idleMs = options?.idleMs ?? IDLE_PADRAO_MS
      const janela = options?.window ?? JANELA_PADRAO

      return withTenant(sql, companyId, async (tx) => {
        const [conversa] = await tx<{ id: string }[]>`
          SELECT id FROM conversations
          WHERE channel = ${identidade.channel}
            AND number_from = ${identidade.numberFrom}
            AND deleted_at IS NULL
        `
        if (conversa === undefined) return undefined

        const [ultima] = await tx<{ created_at: Date }[]>`
          SELECT created_at FROM messages
          WHERE conversation_id = ${conversa.id}
            AND deleted_at IS NULL
          ORDER BY created_at DESC, ctid DESC
          LIMIT 1
        `
        if (ultima === undefined) {
          return { conversationId: conversa.id, messages: [], idle: false }
        }
        if (ultima.created_at.getTime() <= now.getTime() - idleMs) {
          return { conversationId: conversa.id, messages: [], idle: true }
        }

        const linhas = await tx<LinhaMensagem[]>`
          SELECT id, role, body, tool_calls, created_at
          FROM messages
          WHERE conversation_id = ${conversa.id}
            AND deleted_at IS NULL
          ORDER BY created_at DESC, ctid DESC
          LIMIT ${janela}
        `

        return {
          conversationId: conversa.id,
          messages: recorteAposBuraco(linhas, idleMs, janela),
          idle: false,
        } satisfies ActiveContext
      })
    },

    append: async (companyId, turn) => {
      const identidade = parseConversationKey(turn.conversationKey)
      if (identidade === undefined) {
        throw new Error('createConversationStore recusou identidade vazia.')
      }

      await withTenant(sql, companyId, async (tx) => {
        const conversationId = await upsertConversationIdentity(tx, companyId, identidade)
        await tx`
          UPDATE conversations
             SET updated_at = ${turn.at}
           WHERE id = ${conversationId}
        `
        const toolJson = jsonOuNulo(tx, turn.toolCalls)
        await tx`
          INSERT INTO messages
            (company_id, conversation_id, role, body, tool_calls, created_at)
          VALUES
            (${companyId}, ${conversationId}, 'user', ${turn.userBody}, ${toolJson}, ${turn.at})
        `
        await tx`
          INSERT INTO messages
            (company_id, conversation_id, role, body, tool_calls, created_at)
          VALUES
            (${companyId}, ${conversationId}, 'assistant', ${turn.assistantBody}, ${null}, ${turn.at})
        `
      })
    },
  }
}

/**
 * Linhas ja vem DESC (mais nova primeiro). Para no buraco >= idleMs para
 * o recomeco nao herdar o trecho ocioso. Idle vs `now` ja foi cortado
 * antes; aqui nao seta deleted_at.
 */
function recorteAposBuraco(
  linhasMaisNovasPrimeiro: readonly LinhaMensagem[],
  idleMs: number,
  janela: number,
): StoredMessage[] {
  const doMaisNovo: StoredMessage[] = []
  for (const linha of linhasMaisNovasPrimeiro) {
    if (doMaisNovo.length >= janela) break
    const atual = paraMensagem(linha)
    const vizinhaMaisNova = doMaisNovo[doMaisNovo.length - 1]
    if (
      vizinhaMaisNova !== undefined &&
      vizinhaMaisNova.createdAt.getTime() - atual.createdAt.getTime() >= idleMs
    ) {
      break
    }
    doMaisNovo.push(atual)
  }
  return doMaisNovo.reverse()
}

function paraMensagem(l: LinhaMensagem): StoredMessage {
  return {
    id: l.id,
    role: l.role,
    body: l.body,
    createdAt: l.created_at,
    ...(l.tool_calls == null ? {} : { toolCalls: l.tool_calls }),
  }
}

function jsonOuNulo(tx: TransactionSql, valor: unknown) {
  if (valor === undefined || valor === null) return null
  return tx.json(valor as Parameters<TransactionSql['json']>[0])
}

/**
 * Expurgo de 30 dias — NR-062 US5.
 *
 * Cada metodo roda em `withTenant`: o `companyId` da assinatura e o tenant.
 * DELETE real de `messages` (a linha some, nao `body = ''`). Conversa orfa
 * ganha `deleted_at` — NAO `DELETE FROM conversations` (FK confirmations
 * RESTRICT). `now` e injetado; a comparacao nao usa `now()` do banco.
 */
export function createConversationPurgeRepository(sql: Sql): ConversationPurgeRepository {
  return {
    deleteMessagesOlderThan: async (companyId, now, retentionMs) => {
      const corte = new Date(now.getTime() - retentionMs)
      return withTenant(sql, companyId, async (tx) => {
        const apagadas = await tx`
          DELETE FROM messages
          WHERE deleted_at IS NULL
            AND created_at <= ${corte}
        `
        return apagadas.count
      })
    },

    closeConversationsWithoutMessages: async (companyId, now) => {
      return withTenant(sql, companyId, async (tx) => {
        const fechadas = await tx`
          UPDATE conversations
             SET deleted_at = ${now},
                 updated_at = ${now}
           WHERE deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM messages m
                WHERE m.conversation_id = conversations.id
                  AND m.deleted_at IS NULL
             )
        `
        return fechadas.count
      })
    },
  }
}
