import { z } from 'zod'
import { dateSchema, idSchema, moneyCentsSchema } from '../common/primitives.js'

/**
 * Entrada de mercadoria: compra de fornecedor — NR-158.
 *
 * Uma compra soma ao estoque, atualiza o custo do produto (custo medio
 * ponderado) e lanca a conta a pagar ao fornecedor, tudo de uma vez.
 */

export const purchaseItemInputSchema = z
  .object({
    productId: idSchema,
    quantity: z
      .number()
      .int('A quantidade deve ser um numero inteiro de unidades.')
      .min(1, 'A quantidade deve ser maior que zero.')
      .max(1_000_000, 'Quantidade alta demais. Confira o numero.'),
    /** Custo de UMA unidade nesta compra. */
    unitCostCents: moneyCentsSchema,
  })
  .strict()

export type PurchaseItemInput = z.infer<typeof purchaseItemInputSchema>

export const createPurchaseInputSchema = z
  .object({
    /** Texto livre, como na conta a pagar: nao existe cadastro de fornecedor. */
    supplier: z.string().trim().min(2, 'Informe o fornecedor.').max(120, 'Nome muito longo.'),
    invoiceNumber: z.string().trim().max(60, 'Numero da nota muito longo.').optional(),
    notes: z.string().trim().max(500, 'Observacao muito longa.').optional(),
    items: z
      .array(purchaseItemInputSchema)
      .min(1, 'Inclua pelo menos um produto.')
      .max(100, 'No maximo 100 produtos por compra.')
      .refine((itens) => new Set(itens.map((i) => i.productId)).size === itens.length, {
        message: 'O mesmo produto aparece duas vezes. Junte as quantidades numa linha.',
      }),
    /** Vencimento da primeira parcela da conta a pagar. */
    dueDate: dateSchema,
    /** Parcelas mensais. 1 = a vista ou boleto unico. */
    installments: z
      .number()
      .int('O numero de parcelas deve ser inteiro.')
      .min(1, 'Pelo menos uma parcela.')
      .max(12, 'No maximo 12 parcelas.')
      .default(1),
  })
  .strict()

export type CreatePurchaseInput = z.input<typeof createPurchaseInputSchema>
export type CreatePurchaseData = z.output<typeof createPurchaseInputSchema>

export const purchaseItemOutputSchema = z.object({
  productId: idSchema,
  description: z.string(),
  quantity: z.number().int(),
  unitCostCents: z.number().int(),
})

export type PurchaseItemOutput = z.infer<typeof purchaseItemOutputSchema>

export const purchaseOutputSchema = z.object({
  id: idSchema,
  supplier: z.string(),
  invoiceNumber: z.string().nullable(),
  notes: z.string().nullable(),
  totalCents: z.number().int(),
  installments: z.number().int(),
  items: z.array(purchaseItemOutputSchema),
  createdAt: z.string(),
})

export type PurchaseOutput = z.infer<typeof purchaseOutputSchema>

export const purchaseListOutputSchema = z.object({
  purchases: z.array(purchaseOutputSchema),
})

export type PurchaseListOutput = z.infer<typeof purchaseListOutputSchema>
