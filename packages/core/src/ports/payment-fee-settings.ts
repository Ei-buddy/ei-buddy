import type { PaymentFeeSettingsInput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/**
 * Onde moram as taxas de recebimento da loja — DEC-027.
 *
 * `find` devolve `undefined` quando a loja nunca configurou: quem chama usa a
 * tabela padrao (`TAXAS_PADRAO`), e a tela diz que sao os valores padrao.
 */
export type StoredPaymentFeeSettings = PaymentFeeSettingsInput & { readonly updatedAt: string }

export type PaymentFeeSettingsRepository = {
  find(companyId: CompanyId): Promise<StoredPaymentFeeSettings | undefined>
  save(
    companyId: CompanyId,
    settings: PaymentFeeSettingsInput,
    updatedBy: UserId,
    at: Date,
  ): Promise<StoredPaymentFeeSettings>
}
