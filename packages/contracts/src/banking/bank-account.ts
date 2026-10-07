import { z } from 'zod'
import { idSchema } from '../common/primitives.js'

/**
 * Conta bancaria da loja — RF-073, US-035.
 *
 * O saldo inicial vale a partir de `openingDate`: e o numero que o lojista le
 * no extrato daquele dia. Dali em diante, a conta anda pelas baixas.
 */
export const createBankAccountInputSchema = z
  .object({
    name: z.string().trim().min(2, 'De um nome a conta, ex.: "Nubank PJ".').max(60),
    bank: z.string().trim().min(2).max(60).optional(),
    agency: z.string().trim().max(20).optional(),
    accountNumber: z.string().trim().max(30).optional(),
    openingBalanceCents: z.number().int(),
    openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida.'),
  })
  .strict()

export type CreateBankAccountInput = z.infer<typeof createBankAccountInputSchema>

/**
 * Editar — NR-152. O mesmo formulario do cadastro, inteiro: campo opcional que
 * nao veio fica vazio. Renomear leva o nome junto nas baixas ja registradas.
 */
export const updateBankAccountInputSchema = createBankAccountInputSchema

export type UpdateBankAccountInput = CreateBankAccountInput

export const bankAccountOutputSchema = z.object({
  id: idSchema,
  name: z.string(),
  bank: z.string().nullable(),
  agency: z.string().nullable(),
  accountNumber: z.string().nullable(),
  openingBalanceCents: z.number().int(),
  openingDate: z.string(),
  /** Saldo inicial mais o que entrou menos o que saiu, pelas baixas desde `openingDate`. */
  balanceCents: z.number().int(),
})

export type BankAccountOutput = z.infer<typeof bankAccountOutputSchema>
