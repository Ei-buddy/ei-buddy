import type { PaymentFeeSettingsInput } from '@na-regua/contracts'
import type { CompanyId } from '../context.js'
import type {
  PaymentFeeSettingsRepository,
  StoredPaymentFeeSettings,
} from '../ports/payment-fee-settings.js'

/** As taxas da loja em memoria — para testes e para quem compoe sem banco. */
export class InMemoryPaymentFeeSettings implements PaymentFeeSettingsRepository {
  readonly porLoja = new Map<CompanyId, StoredPaymentFeeSettings>()

  async find(companyId: CompanyId): Promise<StoredPaymentFeeSettings | undefined> {
    return this.porLoja.get(companyId)
  }

  async save(
    companyId: CompanyId,
    settings: PaymentFeeSettingsInput,
    _updatedBy: string,
    at: Date,
  ): Promise<StoredPaymentFeeSettings> {
    const salvas = { ...settings, updatedAt: at.toISOString() }
    this.porLoja.set(companyId, salvas)
    return salvas
  }
}
