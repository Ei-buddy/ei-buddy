import type { TransactionSql } from 'postgres'

/**
 * Identidade vigente da conversa — NR-062 (e o upsert que a NR-061 usaria).
 *
 * A row e `(company_id, channel, number_from)` com `deleted_at IS NULL`.
 * `number_from` vazio e fail-closed: parse devolve `undefined`, upsert lanca.
 *
 * T005: `confirmation-repository.ts` nao existe nesta branch (NR-061 nao
 * mesclada). Este helper e para `conversation-repository` (US2).
 */

export type ConversationIdentity = {
  readonly channel: 'app' | 'whatsapp'
  readonly numberFrom: string
}

/**
 * `app:{companyId}:{userId}` → canal `app`, `number_from` = userId.
 * `wa:{companyId}:{peer}` → canal `whatsapp`, `number_from` = peer
 * (peer pode ter dois-pontos — junta a partir do indice 2).
 *
 * Prefixo desconhecido, menos de 3 segmentos ou interlocutor vazio →
 * `undefined`. O UUID da chave que divergir do `companyId` da assinatura
 * perde: o parse nao devolve empresa.
 */
export function parseConversationKey(conversationKey: string): ConversationIdentity | undefined {
  const partes = conversationKey.split(':')
  if (partes.length < 3) return undefined

  const prefixo = partes[0]
  const numberFrom = partes.slice(2).join(':')
  if (numberFrom.trim() === '') return undefined

  if (prefixo === 'app') return { channel: 'app', numberFrom }
  if (prefixo === 'wa') return { channel: 'whatsapp', numberFrom }
  return undefined
}

/**
 * SELECT vigente → INSERT ON CONFLICT DO NOTHING → SELECT de novo.
 *
 * O unico parcial `conversations_identidade_unica` (0019 nesta branch)
 * fecha a corrida: dois upserts simultaneos nao criam duas rows para a
 * mesma identidade. `DO NOTHING` + releitura, nao `DO UPDATE`.
 */
export async function upsertConversationIdentity(
  tx: TransactionSql,
  companyId: string,
  identidade: ConversationIdentity,
): Promise<string> {
  if (identidade.numberFrom.trim() === '') {
    throw new Error('upsertConversationIdentity recusou number_from vazio.')
  }

  const vigente = await buscarVigente(tx, companyId, identidade)
  if (vigente !== undefined) return vigente

  const [inserida] = await tx<{ id: string }[]>`
    INSERT INTO conversations (company_id, channel, number_from)
    VALUES (${companyId}, ${identidade.channel}, ${identidade.numberFrom})
    ON CONFLICT (company_id, channel, number_from) WHERE deleted_at IS NULL
    DO NOTHING
    RETURNING id
  `
  if (inserida !== undefined) return inserida.id

  const deNovo = await buscarVigente(tx, companyId, identidade)
  if (deNovo === undefined) {
    throw new Error('upsertConversationIdentity nao encontrou a conversa apos o conflito.')
  }
  return deNovo
}

async function buscarVigente(
  tx: TransactionSql,
  companyId: string,
  identidade: ConversationIdentity,
): Promise<string | undefined> {
  const [linha] = await tx<{ id: string }[]>`
    SELECT id FROM conversations
    WHERE company_id = ${companyId}
      AND channel = ${identidade.channel}
      AND number_from = ${identidade.numberFrom}
      AND deleted_at IS NULL
  `
  return linha?.id
}
