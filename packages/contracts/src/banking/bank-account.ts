import { z } from 'zod'
import { dateSchema, idSchema } from '../common/primitives.js'

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

/**
 * Extrato da conta — achado do QA: "Bancos: ter um extrato das movimentacoes".
 *
 * O periodo e obrigatorio: extrato sem periodo e o historico inteiro da conta,
 * que so cresce. A tela manda o mes.
 */
export const bankAccountStatementQuerySchema = z
  .object({ from: dateSchema, to: dateSchema })
  .strict()
  .refine((q) => q.from <= q.to, { message: 'O início do período vem antes do fim.' })

export type BankAccountStatementQuery = z.infer<typeof bankAccountStatementQuerySchema>

/** Uma linha do extrato: uma baixa (ou o estorno dela) que citou a conta. */
export const bankAccountStatementEntrySchema = z.object({
  /** A baixa. */
  id: idSchema,
  /** A data da baixa (AAAA-MM-DD), a que casa com o extrato do banco. */
  date: z.string(),
  /** `receivable` entra, `payable` sai. */
  kind: z.enum(['receivable', 'payable']),
  /** Estorno de uma baixa: vem com o sinal contrario e desfaz a original. */
  isReversal: z.boolean(),
  description: z.string(),
  /** Fornecedor ou cliente. Nulo no recebimento sem cliente identificado. */
  counterparty: z.string().nullable(),
  /** Com sinal: positivo entrou, negativo saiu. */
  amountCents: z.number().int(),
  /** O saldo da conta depois desta linha. */
  balanceCents: z.number().int(),
})

export type BankAccountStatementEntry = z.infer<typeof bankAccountStatementEntrySchema>

export const bankAccountStatementOutputSchema = z.object({
  account: bankAccountOutputSchema,
  from: z.string(),
  to: z.string(),
  /** O saldo no comeco do periodo: o inicial mais o que andou antes dele. */
  openingCents: z.number().int(),
  inflowCents: z.number().int(),
  outflowCents: z.number().int(),
  /** O saldo no fim do periodo. */
  closingCents: z.number().int(),
  entries: z.array(bankAccountStatementEntrySchema),
})

export type BankAccountStatementOutput = z.infer<typeof bankAccountStatementOutputSchema>
