import type { CompanyId } from '../context.js'

/**
 * Porta do historico de conversa — NR-062.
 *
 * Declarada aqui, implementada por `db` (Postgres + `withTenant`) e por um
 * fake in-memory no `agent` so para teste. O laco em `processMessage` consome
 * a porta; `agent` NAO importa `db`.
 *
 * `companyId` em toda assinatura de leitura/escrita do fio por decisao, nao
 * por descuido: o isolamento entre empresas nao pode depender de o chamador
 * lembrar de filtrar. Recurso de outra loja parece inexistente —
 * `undefined` / no-op, nunca o corpo da mensagem.
 *
 * Memory/Storage do framework NAO e esta porta.
 */

export type ConversationRole = 'user' | 'assistant' | 'system'

export type StoredMessage = {
  readonly id: string
  readonly role: ConversationRole
  /** Texto visivel. Coluna `body` text NOT NULL — nunca nulo, nunca no log. */
  readonly body: string
  /** jsonb opcional: ids ja resolvidos naquele turno. */
  readonly toolCalls?: unknown
  readonly createdAt: Date
}

export type ActiveContext = {
  readonly conversationId: string
  /** 0..12, ordem cronologica crescente. Vazio se `idle`. */
  readonly messages: readonly StoredMessage[]
  readonly idle: boolean
}

export type AppendTurn = {
  readonly conversationKey: string
  readonly userBody: string
  readonly assistantBody: string
  readonly toolCalls?: unknown
  readonly at: Date
}

export type ConversationStore = {
  /**
   * Recorte ativo do fio, ou `undefined`.
   *
   * `undefined` se a identidade for invalida (`number_from` vazio) OU se
   * ainda nao existe row. NAO cria row so para ler. Loja B carregando a
   * chave da loja A tambem e `undefined` — ausencia, nunca o historico.
   *
   * Defaults: `idleMs = 7_200_000` (2 h), `window = 12`. Se a ultima
   * mensagem vigente tiver `createdAt <= now - idleMs`, `idle === true` e
   * `messages === []`.
   */
  loadActive(
    companyId: CompanyId,
    conversationKey: string,
    now: Date,
    options?: { readonly idleMs?: number; readonly window?: number },
  ): Promise<ActiveContext | undefined>

  /**
   * Upsert da identidade e insert do par user/assistant.
   *
   * Cria a row se preciso. `append` da loja B na chave da loja A nao
   * escreve na A.
   */
  append(companyId: CompanyId, turn: AppendTurn): Promise<void>
}

/**
 * Expurgo de 30 dias (RNF-035). Caso de uso em `core`; SQL em `db`.
 *
 * Nao apaga venda, cadastro nem `audit_logs`. Nao faz `DELETE FROM
 * conversations` — a FK de `confirmations` e RESTRICT; conversa orfa ganha
 * `deleted_at`.
 *
 * `companyId` e o primeiro argumento de cada metodo: o isolamento nao
 * pode depender de o chamador lembrar de filtrar. Varredura de job: a
 * implementacao aplica a retencao DENTRO de cada tenant (`withTenant`).
 * Recurso de outra loja nao aparece.
 */
export type ConversationPurgeRepository = {
  deleteMessagesOlderThan(companyId: CompanyId, now: Date, retentionMs: number): Promise<number>
  closeConversationsWithoutMessages(companyId: CompanyId, now: Date): Promise<number>
}
