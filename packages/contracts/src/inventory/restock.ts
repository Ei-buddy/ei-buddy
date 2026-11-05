import { z } from 'zod'
import { idSchema } from '../common/primitives.js'

/**
 * Sugestao de reposicao — achado do QA na pergunta "quais produtos precisam
 * de reposicao de estoque".
 *
 * A pergunta so olhava o estoque minimo: produto sem minimo cadastrado nunca
 * aparecia, e o de estoque negativo tambem nao (caia em "esgotado"). A regra
 * pedida e a da venda: o que saiu nos ultimos seis meses, dividido por seis, e
 * a media do mes; menos o estoque, e o que falta para um mes. O minimo e o
 * negativo continuam valendo para o produto que ainda nao vendeu.
 */
export const restockReasonSchema = z.enum(['vendas', 'minimo', 'negativo'])

export type RestockReason = z.infer<typeof restockReasonSchema>

export const restockSuggestionSchema = z.object({
  productId: idSchema,
  description: z.string(),
  internalCode: z.string(),
  unitOfMeasure: z.string(),
  stock: z.number().int(),
  minStock: z.number().int(),
  /** Unidades vendidas (menos as devolvidas) desde `since`. */
  soldLast6Months: z.number(),
  /** `soldLast6Months / 6`, com uma casa. */
  monthlyAverage: z.number(),
  /** Quanto comprar, arredondado para cima. Sempre maior que zero. */
  suggestedQuantity: z.number().int().positive(),
  /** Qual regra deu a maior sugestao. */
  reason: restockReasonSchema,
})

export type RestockSuggestion = z.infer<typeof restockSuggestionSchema>

export const restockOutputSchema = z.object({
  /** O comeco da janela de seis meses (AAAA-MM-DD). */
  since: z.string(),
  items: z.array(restockSuggestionSchema),
})

export type RestockOutput = z.infer<typeof restockOutputSchema>
