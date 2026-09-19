import type { Subscription, SubscriptionStatus } from '@na-regua/contracts'
import type { SubscriptionRepository } from '../ports/subscription-repository.js'

/**
 * Assinaturas em memoria — uma por empresa, como a `UNIQUE (company_id)`.
 *
 * A idempotencia do `startTrial` e reproduzida aqui de proposito: e uma
 * promessa da porta, e um falso permissivo deixaria passar o caso em que uma
 * retentativa de cadastro renova o teste de graca.
 */
export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly porEmpresa = new Map<string, Subscription>()

  async findByCompany(companyId: string): Promise<Subscription | undefined> {
    return this.porEmpresa.get(companyId)
  }

  async startTrial(entry: {
    companyId: string
    planCode: string
    trialEndsAt: Date
    createdAt: Date
  }): Promise<Subscription> {
    const existente = this.porEmpresa.get(entry.companyId)
    if (existente) return existente

    const nova: Subscription = {
      companyId: entry.companyId,
      planCode: entry.planCode,
      status: 'trial',
      trialEndsAt: entry.trialEndsAt.toISOString(),
      currentPeriodEndsAt: null,
      couponId: null,
      restrictedAt: null,
      cancelledAt: null,
      nextDueDate: null,
    }
    this.porEmpresa.set(entry.companyId, nova)
    return nova
  }

  async updateStatus(entry: {
    companyId: string
    status: SubscriptionStatus
    restrictedAt: Date | null
    cancelledAt: Date | null
    updatedAt: Date
  }): Promise<void> {
    const atual = this.porEmpresa.get(entry.companyId)
    if (!atual) return

    this.porEmpresa.set(entry.companyId, {
      ...atual,
      status: entry.status,
      restrictedAt: entry.restrictedAt === null ? null : entry.restrictedAt.toISOString(),
      cancelledAt: entry.cancelledAt === null ? null : entry.cancelledAt.toISOString(),
    })
  }

  /** Para o teste montar um estado sem passar pelo caminho feliz. */
  semear(assinatura: Subscription): void {
    this.porEmpresa.set(assinatura.companyId, assinatura)
  }
}
