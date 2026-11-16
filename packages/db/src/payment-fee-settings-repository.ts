import type { PaymentFeeSettingsInput } from '@na-regua/contracts'
import type { PaymentFeeSettingsRepository, StoredPaymentFeeSettings } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/** Taxas de recebimento da loja — DEC-027 (NR-223), migration 0052. */

type Linha = {
  pix_fee_percent: string
  debit_fee_percent: string
  credit_fee_percents: number[]
  brand_overrides: PaymentFeeSettingsInput['brandOverrides']
  debit_settlement_days: number
  credit_settlement_days: number
  anticipation_enabled: boolean
  anticipation_monthly_rate_percent: string | null
  updated_at: Date
}

/* `numeric` chega como texto do driver: converte aqui, e so aqui. */
const paraSaida = (l: Linha): StoredPaymentFeeSettings => ({
  pixFeePercent: Number(l.pix_fee_percent),
  debitFeePercent: Number(l.debit_fee_percent),
  creditFeePercents: l.credit_fee_percents.map(Number),
  brandOverrides: l.brand_overrides,
  debitSettlementDays: l.debit_settlement_days,
  creditSettlementDays: l.credit_settlement_days,
  anticipation: {
    enabled: l.anticipation_enabled,
    monthlyRatePercent:
      l.anticipation_monthly_rate_percent === null
        ? null
        : Number(l.anticipation_monthly_rate_percent),
  },
  updatedAt: l.updated_at.toISOString(),
})

export function createPaymentFeeSettingsRepository(sql: Sql): PaymentFeeSettingsRepository {
  return {
    find: async (companyId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          SELECT pix_fee_percent, debit_fee_percent, credit_fee_percents, brand_overrides,
                 debit_settlement_days, credit_settlement_days,
                 anticipation_enabled, anticipation_monthly_rate_percent, updated_at
            FROM payment_fee_settings
           WHERE company_id = ${companyId}
        `,
      )
      return linha === undefined ? undefined : paraSaida(linha)
    },

    save: async (companyId, s, updatedBy, at) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          INSERT INTO payment_fee_settings (
            company_id, pix_fee_percent, debit_fee_percent, credit_fee_percents,
            brand_overrides, debit_settlement_days, credit_settlement_days,
            anticipation_enabled, anticipation_monthly_rate_percent, updated_at, updated_by
          ) VALUES (
            ${companyId}, ${s.pixFeePercent}, ${s.debitFeePercent},
            ${tx.json(s.creditFeePercents)}, ${tx.json(s.brandOverrides)},
            ${s.debitSettlementDays}, ${s.creditSettlementDays},
            ${s.anticipation.enabled}, ${s.anticipation.monthlyRatePercent},
            ${at}, ${updatedBy}
          )
          ON CONFLICT (company_id) DO UPDATE SET
            pix_fee_percent = EXCLUDED.pix_fee_percent,
            debit_fee_percent = EXCLUDED.debit_fee_percent,
            credit_fee_percents = EXCLUDED.credit_fee_percents,
            brand_overrides = EXCLUDED.brand_overrides,
            debit_settlement_days = EXCLUDED.debit_settlement_days,
            credit_settlement_days = EXCLUDED.credit_settlement_days,
            anticipation_enabled = EXCLUDED.anticipation_enabled,
            anticipation_monthly_rate_percent = EXCLUDED.anticipation_monthly_rate_percent,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
          RETURNING pix_fee_percent, debit_fee_percent, credit_fee_percents, brand_overrides,
                    debit_settlement_days, credit_settlement_days,
                    anticipation_enabled, anticipation_monthly_rate_percent, updated_at
        `,
      )
      return paraSaida(linha!)
    },
  }
}
