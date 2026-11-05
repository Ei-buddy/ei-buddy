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

/**
 * Uma parcela da conta a pagar, com vencimento e valor escolhidos — achado do
 * QA: "ao inves de vencimento so da primeira parcela, escolher o vencimento
 * de todas, podendo alterar o valor de cada uma".
 */
export const purchaseParcelInputSchema = z
  .object({
    dueDate: dateSchema,
    amountCents: moneyCentsSchema.min(1, 'A parcela precisa ter valor.'),
  })
  .strict()

export type PurchaseParcelInput = z.infer<typeof purchaseParcelInputSchema>

export const createPurchaseInputSchema = z
  .object({
    /**
     * O nome do fornecedor como sai na compra e na conta a pagar. Com
     * `supplierId`, e o nome do cadastro (NR-191); sem, o texto digitado.
     */
    supplier: z.string().trim().min(2, 'Informe o fornecedor.').max(120, 'Nome muito longo.'),
    /** O fornecedor do cadastro — NR-191. Opcional: da para lancar so com o nome. */
    supplierId: idSchema.optional(),
    invoiceNumber: z.string().trim().max(60, 'Numero da nota muito longo.').optional(),
    notes: z.string().trim().max(500, 'Observacao muito longa.').optional(),
    items: z
      .array(purchaseItemInputSchema)
      .min(1, 'Inclua pelo menos um produto.')
      .max(100, 'No maximo 100 produtos por compra.')
      .refine((itens) => new Set(itens.map((i) => i.productId)).size === itens.length, {
        message: 'O mesmo produto aparece duas vezes. Junte as quantidades numa linha.',
      }),
    /** Vencimento da primeira parcela, quando as parcelas sao mensais e iguais. */
    dueDate: dateSchema.optional(),
    /** Parcelas mensais. 1 = a vista ou boleto unico. */
    installments: z
      .number()
      .int('O numero de parcelas deve ser inteiro.')
      .min(1, 'Pelo menos uma parcela.')
      .max(12, 'No maximo 12 parcelas.')
      .default(1),
    /**
     * As parcelas uma a uma, com vencimento e valor — quando vem, manda: a
     * soma tem de fechar com o total da compra (quem confere e o `core`).
     */
    parcels: z
      .array(purchaseParcelInputSchema)
      .min(1, 'Pelo menos uma parcela.')
      .max(12, 'No maximo 12 parcelas.')
      .optional(),
  })
  .strict()
  .refine((c) => c.dueDate !== undefined || c.parcels !== undefined, {
    message: 'Informe o vencimento.',
    path: ['dueDate'],
  })

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
  supplierId: idSchema.nullable(),
  /** `cancelled` = estornada: o estoque voltou e as contas foram canceladas. */
  status: z.enum(['active', 'cancelled']),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
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

/** Estorno da compra — achado do QA ("poder estornar a compra"). */
export const cancelPurchaseInputSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(3, 'Diga por que está estornando.')
      .max(280, 'Motivo muito longo.'),
  })
  .strict()

export type CancelPurchaseInput = z.infer<typeof cancelPurchaseInputSchema>
