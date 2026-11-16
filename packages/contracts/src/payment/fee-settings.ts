import { z } from 'zod'
import { dateTimeSchema } from '../common/primitives.js'
import { cardBrandSchema } from '../sale/sale.js'

/**
 * Taxas de recebimento da loja — DEC-027.
 *
 * Decisao de 15/11: sem tabela fixa. Cada loja informa a taxa de cada forma
 * de pagamento, e a venda grava a taxa junto, para o contas a receber nascer
 * liquido e o DRE apurar o valor certo.
 *
 * Antes havia DUAS tabelas fixas no codigo — a do PDV (Pix 0,99%, debito
 * 1,99%, credito 3,49%) e a do servidor (credito 3%, 5%, ...) —, e o lojista
 * via na tela um liquido que nao era o que ficava gravado.
 *
 * Percentuais em pontos: 2.99 = 2,99%.
 */

/** Uma taxa, de 0 a 30%, com ate duas casas. */
export const feePercentSchema = z
  .number({ error: 'Informe a taxa em numero.' })
  .min(0, 'Taxa nao pode ser negativa.')
  .max(30, 'Taxa acima de 30% — confira o numero.')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, {
    message: 'Taxa com no maximo duas casas decimais.',
  })

/** Quantas parcelas o PDV oferece no credito. */
export const MAX_PARCELAS_DA_TABELA = 12

const diasDeRepasseSchema = z
  .number()
  .int('Prazo de repasse em dias inteiros.')
  .min(0, 'Prazo de repasse nao pode ser negativo.')
  .max(60, 'Prazo de repasse acima de 60 dias — confira.')

/** Bandeira com taxa diferente da tabela geral. */
export const brandFeeOverrideSchema = z
  .object({
    brand: cardBrandSchema.exclude(['unknown']),
    method: z.enum(['debit', 'credit']),
    /** So no credito; no debito e sempre 1. */
    installments: z.number().int().min(1).max(MAX_PARCELAS_DA_TABELA),
    feePercent: feePercentSchema,
  })
  .strict()
  .refine((o) => o.method === 'credit' || o.installments === 1, {
    message: 'Debito nao tem parcelas.',
    path: ['installments'],
  })

export type BrandFeeOverride = z.infer<typeof brandFeeOverrideSchema>

export const paymentFeeSettingsInputSchema = z
  .object({
    pixFeePercent: feePercentSchema,
    debitFeePercent: feePercentSchema,
    /**
     * Credito por numero de parcelas: a posicao 0 e o 1x (a vista), a 1 e o
     * 2x, e assim por diante. Pelo menos o 1x; no maximo 12x.
     */
    creditFeePercents: z
      .array(feePercentSchema)
      .min(1, 'Informe pelo menos a taxa do credito a vista.')
      .max(MAX_PARCELAS_DA_TABELA, `No maximo ${MAX_PARCELAS_DA_TABELA} parcelas.`),
    /** Bandeiras com taxa diferente. Vazio = todas usam a tabela geral. */
    brandOverrides: z.array(brandFeeOverrideSchema).max(120).default([]),
    /** Em quantos dias o debito cai na conta. */
    debitSettlementDays: diasDeRepasseSchema,
    /** Em quantos dias cai a 1a parcela do credito; a N-esima, em N vezes isso. */
    creditSettlementDays: diasDeRepasseSchema,
    /**
     * Antecipacao — so o espaco para parametrizar (DEC-027). A rotina de
     * antecipar recebiveis fica para uma fase futura: guardar isto NAO muda
     * o vencimento de nada hoje.
     */
    anticipation: z
      .object({
        enabled: z.boolean(),
        monthlyRatePercent: feePercentSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (s) =>
      new Set(s.brandOverrides.map((o) => `${o.brand}:${o.method}:${o.installments}`)).size ===
      s.brandOverrides.length,
    { message: 'A mesma bandeira e parcela aparece mais de uma vez.', path: ['brandOverrides'] },
  )

export type PaymentFeeSettingsInput = z.infer<typeof paymentFeeSettingsInputSchema>

export const paymentFeeSettingsOutputSchema = z.object({
  pixFeePercent: z.number(),
  debitFeePercent: z.number(),
  creditFeePercents: z.array(z.number()),
  brandOverrides: z.array(
    z.object({
      brand: cardBrandSchema,
      method: z.enum(['debit', 'credit']),
      installments: z.number().int(),
      feePercent: z.number(),
    }),
  ),
  debitSettlementDays: z.number().int(),
  creditSettlementDays: z.number().int(),
  anticipation: z.object({ enabled: z.boolean(), monthlyRatePercent: z.number().nullable() }),
  /** `true` = a loja nunca configurou: estes sao os valores padrao. */
  isDefault: z.boolean(),
  updatedAt: dateTimeSchema.nullable(),
})

export type PaymentFeeSettingsOutput = z.infer<typeof paymentFeeSettingsOutputSchema>
