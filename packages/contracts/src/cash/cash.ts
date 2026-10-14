import { z } from 'zod'
import { idSchema, moneyCentsSchema } from '../common/primitives.js'
import { paymentMethodSchema } from '../sale/sale.js'

/**
 * Abertura e fechamento de caixa — NR-157.
 *
 * O caixa e o dinheiro da GAVETA: abre com troco inicial, recebe as vendas em
 * dinheiro, perde nas sangrias, ganha nos suprimentos e fecha com a contagem.
 * As outras formas aparecem no fechamento so para conferir com a maquininha.
 */

export const openCashInputSchema = z
  .object({
    openingCents: moneyCentsSchema.min(0, 'O troco inicial nao pode ser negativo.'),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()

export type OpenCashInput = z.infer<typeof openCashInputSchema>

export const cashMovementKindSchema = z.enum(['withdrawal', 'deposit'])

export const cashMovementInputSchema = z
  .object({
    /** `withdrawal` = sangria (tira da gaveta); `deposit` = suprimento (poe). */
    kind: cashMovementKindSchema,
    amountCents: moneyCentsSchema.min(1, 'Informe um valor maior que zero.'),
    reason: z.string().trim().min(3, 'Diga o motivo.').max(280, 'Motivo muito longo.'),
  })
  .strict()

export type CashMovementInput = z.infer<typeof cashMovementInputSchema>

export const closeCashInputSchema = z
  .object({
    countedCents: moneyCentsSchema.min(0, 'A contagem nao pode ser negativa.'),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()

export type CloseCashInput = z.infer<typeof closeCashInputSchema>

export const cashMovementOutputSchema = z.object({
  id: idSchema,
  kind: cashMovementKindSchema,
  amountCents: z.number().int(),
  reason: z.string(),
  createdAt: z.string(),
})

export type CashMovementOutput = z.infer<typeof cashMovementOutputSchema>

export const cashSessionOutputSchema = z.object({
  id: idSchema,
  status: z.enum(['open', 'closed']),
  openingCents: z.number().int(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  /** Gravados no fechamento; nulos com o caixa aberto. */
  expectedCents: z.number().int().nullable(),
  countedCents: z.number().int().nullable(),
  notes: z.string().nullable(),
})

export type CashSessionOutput = z.infer<typeof cashSessionOutputSchema>

/** O resumo do caixa: o que a gaveta deve ter, e o que entrou por forma. */
export const cashSummarySchema = z.object({
  session: cashSessionOutputSchema,
  movements: z.array(cashMovementOutputSchema),
  /** Vendas do periodo do caixa, por forma, ja sem troco e sem estornadas. */
  salesByMethod: z.array(z.object({ method: paymentMethodSchema, amountCents: z.number().int() })),
  salesCount: z.number().int(),
  depositsCents: z.number().int(),
  withdrawalsCents: z.number().int(),
  /** Troco inicial + vendas em dinheiro + suprimentos − sangrias. */
  expectedCashCents: z.number().int(),
})

export type CashSummary = z.infer<typeof cashSummarySchema>

/** O caixa atual — `null` quando nenhum esta aberto. */
export const currentCashOutputSchema = z.object({ current: cashSummarySchema.nullable() })

export type CurrentCashOutput = z.infer<typeof currentCashOutputSchema>

export const cashHistoryOutputSchema = z.object({ sessions: z.array(cashSessionOutputSchema) })

export type CashHistoryOutput = z.infer<typeof cashHistoryOutputSchema>
