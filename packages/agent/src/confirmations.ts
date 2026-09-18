import { randomUUID } from 'node:crypto'
import type { ConfirmationDecision, ConfirmationStore, PendingConfirmation } from './types.js'

/**
 * Confirmacoes em memoria — fake de teste da NR-061.
 *
 * Persistencia em Postgres e US2 (`createConfirmationStore`). Aqui o laço de
 * `processMessage` e testavel sem banco: mesma porta, mesma assinatura.
 * `resolve` apaga; FR-011 (linha permanece) e o Postgres.
 */
export class InMemoryConfirmations implements ConfirmationStore {
  private readonly itens = new Map<string, PendingConfirmation>()

  async put(pending: PendingConfirmation): Promise<void> {
    for (const [id, atual] of this.itens) {
      if (
        atual.companyId === pending.companyId &&
        atual.conversationKey === pending.conversationKey
      ) {
        this.itens.delete(id)
      }
    }
    this.itens.set(pending.id, pending)
  }

  async getOpen(
    companyId: PendingConfirmation['companyId'],
    conversationKey: string,
    _now: Date,
  ): Promise<PendingConfirmation | undefined> {
    for (const pending of this.itens.values()) {
      if (pending.companyId === companyId && pending.conversationKey === conversationKey) {
        return pending
      }
    }
    return undefined
  }

  async resolve(
    companyId: PendingConfirmation['companyId'],
    id: string,
    _decision: ConfirmationDecision,
  ): Promise<void> {
    const atual = this.itens.get(id)
    if (atual === undefined || atual.companyId !== companyId) return
    this.itens.delete(id)
  }
}

export function novaConfirmacao(dados: Omit<PendingConfirmation, 'id'>): PendingConfirmation {
  return { id: randomUUID(), ...dados }
}
