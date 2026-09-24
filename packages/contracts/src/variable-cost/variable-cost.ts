import { z } from 'zod'
import { idSchema } from '../common/primitives.js'

/**
 * Custo variavel — percentual sobre o preco de venda. Topico 6 do TXT.
 *
 * Tarifa do cartao, imposto, custo operacional, comissao. Da empresa, e nao do
 * produto: vale para todo item vendido, e a tela de produto mostra quanto ele
 * leva de cada venda.
 */
export const createVariableCostInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome do custo.').max(80, 'Nome muito longo.'),
    /** Em pontos percentuais: 3.5 = 3,5% do preco de venda. */
    ratePercent: z
      .number({ error: 'Informe o percentual.' })
      .min(0.01, 'Informe um percentual maior que zero.')
      .max(100, 'O percentual nao pode passar de 100%.'),
  })
  .strict()

export type CreateVariableCostInput = z.infer<typeof createVariableCostInputSchema>

export const variableCostOutputSchema = z.object({
  id: idSchema,
  name: z.string(),
  ratePercent: z.number(),
  createdAt: z.string(),
})

export type VariableCostOutput = z.infer<typeof variableCostOutputSchema>
