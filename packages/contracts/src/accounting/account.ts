import { z } from 'zod'
import { dateSchema, idSchema } from '../common/primitives.js'

/** Plano de contas e DRE — RF-081 a RF-086. */

/**
 * Para onde a conta vai no DRE.
 *
 * Quatro tipos, e nao a arvore contabil completa: o lojista nao quer plano de
 * contas, quer saber se o mes fechou no azul (US-041). Uma estrutura com
 * grupos, subgrupos e codigo hierarquico exigiria que ele entendesse
 * contabilidade para lancar a conta de luz.
 *
 * O contador que precisar da estrutura completa recebe a exportacao (RF-087) e
 * mapeia no sistema dele, que e onde essa estrutura serve para alguma coisa.
 */
export const accountTypeSchema = z.enum(['revenue', 'deduction', 'cost', 'expense'])

export type AccountType = z.infer<typeof accountTypeSchema>

export const createAccountInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome da conta muito curto.').max(80, 'Nome muito longo.'),
    type: accountTypeSchema,
  })
  .strict()

export type CreateAccountInput = z.infer<typeof createAccountInputSchema>

export const renameAccountInputSchema = z
  .object({
    accountId: idSchema,
    name: z.string().trim().min(2, 'Nome da conta muito curto.').max(80, 'Nome muito longo.'),
  })
  .strict()

export type RenameAccountInput = z.infer<typeof renameAccountInputSchema>

export const deleteAccountInputSchema = z.object({ accountId: idSchema }).strict()

export type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>

/**
 * O que pode ser classificado — RF-083.
 *
 * Conta a pagar e recebivel, e nao "lancamento" generico: sao as duas coisas
 * que existem e que o lojista reconhece. Um tipo generico obrigaria a inventar
 * um id unificado que nenhuma tabela tem.
 */
export const entryKindSchema = z.enum(['payable', 'receivable'])

export type EntryKind = z.infer<typeof entryKindSchema>

export const classifyEntryInputSchema = z
  .object({
    entryKind: entryKindSchema,
    entryId: idSchema,
    accountId: idSchema,
  })
  .strict()

export type ClassifyEntryInput = z.infer<typeof classifyEntryInputSchema>

/** Sugestao a partir do historico — RF-084. */
export const suggestAccountInputSchema = z
  .object({
    entryKind: entryKindSchema,
    /** Fornecedor da conta a pagar, ou origem do recebivel. */
    counterparty: z.string().trim().min(1, 'Informe o fornecedor ou a origem.').max(140),
  })
  .strict()

export type SuggestAccountInput = z.infer<typeof suggestAccountInputSchema>

/** Periodo do DRE — RF-085. */
export const dreInputSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .strict()
  .refine((p) => p.from <= p.to, {
    message: 'O inicio do periodo nao pode ser depois do fim.',
    path: ['from'],
  })

export type DreInput = z.infer<typeof dreInputSchema>

export const accountOutputSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: accountTypeSchema,
  /** Conta do plano padrao nao pode ser apagada — RF-081, RF-082. */
  isDefault: z.boolean(),
})

export type AccountOutput = z.infer<typeof accountOutputSchema>

/** Uma linha do DRE, com o que ela agrega — RF-086. */
/**
 * O bloco do DRE gerencial (margem de contribuicao) em que a linha entra —
 * achado do QA. `type` continua sendo o do plano de contas; `group` e onde a
 * linha aparece no formato pedido.
 */
export const dreGroupSchema = z.enum(['sales', 'discounts', 'variable_costs', 'expenses'])
export type DreGroup = z.infer<typeof dreGroupSchema>

export const dreLineSchema = z.object({
  accountId: idSchema.nullable(),
  accountName: z.string(),
  type: accountTypeSchema,
  group: dreGroupSchema,
  amountCents: z.number().int(),
  /** Quantos lancamentos compoem a linha — o "clique para detalhar". */
  entryCount: z.number().int(),
})

export type DreLine = z.infer<typeof dreLineSchema>

export const dreOutputSchema = z.object({
  from: z.string(),
  to: z.string(),
  grossRevenueCents: z.number().int(),
  deductionsCents: z.number().int(),
  netRevenueCents: z.number().int(),
  costCents: z.number().int(),
  grossProfitCents: z.number().int(),
  expensesCents: z.number().int(),
  resultCents: z.number().int(),
  /** Pontos por cem (18 = 18%). Nulo quando nao houve receita. */
  grossMarginPoints: z.number().nullable(),
  /*
   * DRE gerencial — o formato pedido pelo QA. Os mesmos lancamentos,
   * reagrupados: `operatingResultCents` e sempre igual a `resultCents`.
   *
   *   Vendas brutas (grossRevenueCents)
   *   (-) Descontos e devolucoes
   *   = Venda liquida
   *   (-) Custos variaveis: impostos, tarifas de cartao, mercadoria
   *   = Margem de contribuicao
   *   (-) cada conta de despesa do plano
   *   = Resultado operacional
   */
  discountsCents: z.number().int(),
  netSalesCents: z.number().int(),
  variableCostsCents: z.number().int(),
  contributionMarginCents: z.number().int(),
  /** Sobre a venda liquida, em pontos. Nulo sem venda. */
  contributionMarginPoints: z.number().nullable(),
  operatingExpensesCents: z.number().int(),
  operatingResultCents: z.number().int(),
  lines: z.array(dreLineSchema),
})

export type DreOutput = z.infer<typeof dreOutputSchema>
