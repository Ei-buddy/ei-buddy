import { z } from 'zod'
import { idSchema, phoneSchema } from '../common/primitives.js'

/**
 * Disparo pontual de cobranca pelo assistente — US-052, RF-107.
 *
 * `customerId` e/ou telefone. Sem `companyId`: o tenant vem do contexto de
 * execucao, nunca do body (principio 8). Os dois campos juntos existem porque
 * a mensagem pode trazer o id ja resolvido ou so o numero que o lojista ditou.
 */
export const sendChargeInputSchema = z
  .object({
    customerId: idSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .strict()
  .refine((v) => v.customerId !== undefined || v.phone !== undefined, {
    message: 'Informe o cliente ou o telefone para enviar a cobranca.',
  })

export type SendChargeInput = z.infer<typeof sendChargeInputSchema>
