import type { CompanyId } from '../context.js'

/**
 * Porta da pendencia de acao sensivel — NR-061, RF-103, RF-104.
 *
 * Declarada aqui, implementada por `db` (Postgres + `withTenant`). O laço em
 * `agent` consome a porta; `agent` NAO importa `db`. Fake in-memory fica no
 * agente so para teste unitario sem Postgres.
 *
 * `companyId` em toda assinatura por decisao, nao por descuido: o isolamento
 * entre empresas nao pode depender de o chamador lembrar de filtrar. Recurso
 * de outra loja parece inexistente — `undefined` / no-op, nunca o payload.
 *
 * HITL do framework (`requireToolApproval`) NAO e esta porta.
 */

/** Aceite, recusa ou expiracao. Terminais: a linha permanece (FR-011). */
export type ConfirmationDecision = 'accepted' | 'rejected' | 'expired'

export type PendingConfirmation = {
  readonly id: string
  readonly companyId: CompanyId
  readonly conversationKey: string
  readonly toolId: string
  readonly args: unknown
  readonly summary: string
  readonly expiresAt: Date
}

export type ConfirmationStore = {
  /**
   * Grava a proposta. Na mesma identidade (`conversationKey` daquela loja),
   * encerra a aberta anterior como `rejected` — nao executa, nao apaga.
   */
  put(pending: PendingConfirmation): Promise<void>

  /**
   * A aberta da conversa, ou `undefined`.
   *
   * `now` entra porque o laço ja tem `ctx.now`; o store NAO filtra por
   * `expiresAt`. Pendencia vencida ainda com `resolved_at` nulo DEVE voltar,
   * para o laço emitir "expirou" em vez de sumir o texto.
   */
  getOpen(
    companyId: CompanyId,
    conversationKey: string,
    now: Date,
  ): Promise<PendingConfirmation | undefined>

  /**
   * Marca a decisao. No-op — nao lanca, nao vaza — se o id nao existe, ja
   * esta resolvido, ou pertence a outra loja.
   */
  resolve(companyId: CompanyId, id: string, decision: ConfirmationDecision): Promise<void>
}
