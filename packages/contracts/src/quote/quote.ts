import { z } from 'zod'
import { dateSchema, idSchema, moneyCentsSchema } from '../common/primitives.js'

/**
 * Orcamento — NR-159.
 *
 * Proposta ao cliente que nao baixa estoque nem gera financeiro. Os precos
 * ficam gravados: o prometido nao muda com a tabela. Aceito, vira venda pelo
 * PDV, e o orcamento guarda a venda que nasceu dele.
 */

export const quoteStatusSchema = z.enum(['open', 'converted', 'cancelled'])

export type QuoteStatus = z.infer<typeof quoteStatusSchema>

export const quoteItemInputSchema = z
  .object({
    productId: idSchema,
    quantity: z
      .number()
      .int('A quantidade deve ser um numero inteiro.')
      .min(1, 'A quantidade deve ser maior que zero.')
      .max(100_000, 'Quantidade alta demais. Confira o numero.'),
    unitPriceCents: moneyCentsSchema,
  })
  .strict()

export const createQuoteInputSchema = z
  .object({
    customerName: z.string().trim().max(120, 'Nome muito longo.').optional(),
    items: z
      .array(quoteItemInputSchema)
      .min(1, 'Inclua pelo menos um produto.')
      .max(200, 'Orcamento com itens demais.')
      .refine((itens) => new Set(itens.map((i) => i.productId)).size === itens.length, {
        message: 'O mesmo produto aparece duas vezes. Junte as quantidades numa linha.',
      }),
    validUntil: dateSchema,
    discountCents: moneyCentsSchema.optional(),
    notes: z.string().trim().max(500, 'Observacao muito longa.').optional(),
  })
  .strict()

export type CreateQuoteInput = z.infer<typeof createQuoteInputSchema>

export const convertQuoteInputSchema = z.object({ saleId: idSchema }).strict()

export type ConvertQuoteInput = z.infer<typeof convertQuoteInputSchema>

export const quoteItemOutputSchema = z.object({
  productId: idSchema,
  description: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  /** Dados ATUAIS do produto, para o PDV montar o carrinho ao converter. */
  code: z.string(),
  costPriceCents: z.number().int(),
  stock: z.number().int(),
  isActive: z.boolean(),
})

export type QuoteItemOutput = z.infer<typeof quoteItemOutputSchema>

export const quoteOutputSchema = z.object({
  id: idSchema,
  number: z.number().int(),
  customerName: z.string().nullable(),
  status: quoteStatusSchema,
  validUntil: z.string(),
  notes: z.string().nullable(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
  saleId: idSchema.nullable(),
  /** O numero da venda que nasceu dele — para "Ver venda #N" (NR-172). */
  saleNumber: z.number().int().nullable(),
  items: z.array(quoteItemOutputSchema),
  createdAt: z.string(),
})

export type QuoteOutput = z.infer<typeof quoteOutputSchema>
