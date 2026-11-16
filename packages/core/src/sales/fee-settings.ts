import type { PaymentFeeSettingsInput, PaymentFeeSettingsOutput } from '@na-regua/contracts'
import type { CardFeeTable } from '@na-regua/domain'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { PaymentFeeSettingsRepository } from '../ports/payment-fee-settings.js'
import type { CompanySettingsRepository } from '../ports/sale-writers.js'

/**
 * Taxas de recebimento por loja — DEC-027.
 *
 * Decisao de 15/11: sem tabela fixa. A loja informa a taxa de cada forma de
 * pagamento; a venda grava a taxa junto, o contas a receber nasce liquido e o
 * DRE apura o valor certo.
 */

/**
 * A tabela de quem nunca configurou.
 *
 * E a MESMA de antes da DEC-027 (credito 3% a vista, 5% em 2x e +1,5 ponto
 * por parcela a partir da 3x; debito igual ao credito a vista; repasse em 30
 * dias; Pix sem taxa): a venda de quem nao configurou nao muda de valor.
 */
export const TAXAS_PADRAO: PaymentFeeSettingsInput = {
  pixFeePercent: 0,
  debitFeePercent: 3,
  creditFeePercents: [3, 5, ...Array.from({ length: 10 }, (_, i) => 6 + i * 1.5)],
  brandOverrides: [],
  debitSettlementDays: 30,
  creditSettlementDays: 30,
  anticipation: { enabled: false, monthlyRatePercent: null },
}

/** As taxas da loja na forma que o dominio calcula. */
export function tabelaDeTarifas(s: PaymentFeeSettingsInput): CardFeeTable {
  const credito = s.brandOverrides.filter((o) => o.method === 'credit')
  const debito = s.brandOverrides.filter((o) => o.method === 'debit')

  return {
    rates: [
      ...s.creditFeePercents.map((feeRatePercent, i) => ({
        brand: 'unknown' as const,
        installments: i + 1,
        feeRatePercent,
      })),
      ...credito.map((o) => ({
        brand: o.brand,
        installments: o.installments,
        feeRatePercent: o.feePercent,
      })),
    ],
    settlementDays: s.creditSettlementDays,
    debitRates: [
      { brand: 'unknown' as const, feeRatePercent: s.debitFeePercent },
      ...debito.map((o) => ({ brand: o.brand, feeRatePercent: o.feePercent })),
    ],
    debitSettlementDays: s.debitSettlementDays,
    pixFeePercent: s.pixFeePercent,
  }
}

export type PaymentFeeSettingsDeps = {
  readonly feeSettings: PaymentFeeSettingsRepository
  readonly audit?: AuditTrail
}

/** As taxas da loja; sem configuracao, as padrao — com `isDefault`. */
export async function getPaymentFeeSettings(
  deps: PaymentFeeSettingsDeps,
  ctx: ExecutionContext,
): Promise<PaymentFeeSettingsOutput> {
  const salvas = await deps.feeSettings.find(ctx.companyId)
  if (salvas === undefined) return { ...TAXAS_PADRAO, isDefault: true, updatedAt: null }
  const { updatedAt, ...taxas } = salvas
  return { ...taxas, isDefault: false, updatedAt }
}

/**
 * Grava as taxas — so o responsavel pela loja.
 *
 * Taxa muda o liquido de toda venda dali em diante; quem opera o balcao nao
 * decide isso, assim como nao convida usuario.
 */
export async function savePaymentFeeSettings(
  deps: PaymentFeeSettingsDeps,
  ctx: ExecutionContext,
  input: PaymentFeeSettingsInput,
): Promise<PaymentFeeSettingsOutput> {
  assertCanWrite(ctx)
  if (ctx.role !== 'owner') {
    throw AppError.forbidden('Somente o responsável pela loja altera as taxas de recebimento.')
  }

  const salvas = await deps.feeSettings.save(ctx.companyId, input, ctx.userId, ctx.now)

  await deps.audit?.record({
    companyId: ctx.companyId,
    entity: 'PaymentFeeSettings',
    entityId: ctx.companyId,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: {
      pix: input.pixFeePercent,
      debito: input.debitFeePercent,
      credito: input.creditFeePercents,
      bandeiras: input.brandOverrides.length,
    },
  })

  const { updatedAt, ...taxas } = salvas
  return { ...taxas, isDefault: false, updatedAt }
}

/**
 * A configuracao de venda com as taxas DA LOJA.
 *
 * Aliquota e teto de desconto continuam vindo de `base`; a tabela de tarifas
 * passa a ser a que a loja gravou, e a padrao para quem nunca gravou.
 */
export function comTaxasDaLoja(
  base: CompanySettingsRepository,
  feeSettings: PaymentFeeSettingsRepository,
): CompanySettingsRepository {
  return {
    forSale: async (companyId, role) => {
      const [padrao, salvas] = await Promise.all([
        base.forSale(companyId, role),
        feeSettings.find(companyId),
      ])
      return salvas === undefined ? padrao : { ...padrao, cardFees: tabelaDeTarifas(salvas) }
    },
  }
}
