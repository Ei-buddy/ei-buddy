import { z } from 'zod'
import { entryKindSchema } from '../accounting/account.js'
import { dateSchema, idSchema, moneyCentsSchema } from '../common/primitives.js'

/** Conciliacao bancaria — RF-078 a RF-080. */

/**
 * Para onde o dinheiro foi.
 *
 * Direcao explicita, e nao valor com sinal, por dois motivos. O extrato de OFX
 * traz o sinal de formas diferentes entre bancos, e converter na importacao
 * apagaria a informacao de qual convencao veio. E, aqui dentro, `direction`
 * torna a regra legivel: debito casa com conta a pagar, credito com recebivel.
 * `amountCents < 0` obrigaria a lembrar dessa traducao em cada comparacao.
 */
export const bankTransactionDirectionSchema = z.enum(['debit', 'credit'])

export type BankTransactionDirection = z.infer<typeof bankTransactionDirectionSchema>

export const bankTransactionOutputSchema = z.object({
  id: idSchema,
  /**
   * Identificador do banco (FITID no OFX).
   *
   * E o que impede a mesma transacao de entrar duas vezes quando o lojista
   * sobe o extrato de novo — RF-074, RF-076.
   */
  externalId: z.string(),
  direction: bankTransactionDirectionSchema,
  /** Sempre positivo. Quem diz o sinal e `direction`. */
  amountCents: moneyCentsSchema,
  /** Data em que o banco lancou. */
  postedOn: dateSchema,
  description: z.string(),
  /** Quem pagou ou recebeu, quando o banco informa. */
  counterparty: z.string().nullable(),
  /** Nulos enquanto a transacao esta na fila. */
  reconciledEntryKind: entryKindSchema.nullable(),
  reconciledEntryId: idSchema.nullable(),
  /**
   * A baixa que a conciliacao lancou — DEC-026. Nula na fila, na conciliacao
   * de titulo que ja estava quitado (o recebivel do cartao nasce liquidado) e
   * nas conciliacoes de antes da DEC-026. E ela que o desfazer estorna.
   */
  settlementId: idSchema.nullable(),
})

export type BankTransactionOutput = z.infer<typeof bankTransactionOutputSchema>

/** Pedir as sugestoes de uma transacao — RF-078. */
export const suggestMatchesInputSchema = z.object({ transactionId: idSchema }).strict()

export type SuggestMatchesInput = z.infer<typeof suggestMatchesInputSchema>

/**
 * A conta da loja em que o extrato caiu — DEC-026.
 *
 * Conciliar da baixa, e a baixa diz em que conta o dinheiro entrou ou saiu. O
 * extrato e de UMA conta; quem sabe qual e a pessoa, que o baixou do banco.
 */
export const contaDaBaixaSchema = z
  .string()
  .trim()
  .min(1, 'Escolha a conta bancária do extrato.')
  .max(80)

/** Casar transacao com lancamento existente — RF-079. */
export const reconcileInputSchema = z
  .object({
    transactionId: idSchema,
    entryKind: entryKindSchema,
    entryId: idSchema,
    /**
     * Com a conta, concilia E da baixa (DEC-026). Sem ela, so liga os dois —
     * o comportamento de antes, mantido para quem ainda chama assim.
     */
    bankAccount: contaDaBaixaSchema.optional(),
  })
  .strict()

export type ReconcileInput = z.infer<typeof reconcileInputSchema>

/**
 * Criar o lancamento a partir da transacao — RF-079.
 *
 * Valor e data saem da transacao e NAO entram aqui: sao o extrato, e deixar o
 * lojista digitar de novo abriria a chance de criar um lancamento que nao
 * corresponde a linha que ele esta conciliando. O que ele informa e o que o
 * banco nao sabe — o nome de quem esta do outro lado e para que serviu.
 */
export const createEntryFromTransactionInputSchema = z
  .object({
    transactionId: idSchema,
    counterparty: z.string().trim().min(2, 'Informe o fornecedor ou a origem.').max(140),
    description: z.string().trim().min(2, 'Descreva o lancamento.').max(200),
    /** Classificacao ja na criacao, opcional — RF-083. */
    accountId: idSchema.optional(),
    /** Com a conta do extrato, o lancamento ja nasce baixado — DEC-026. */
    bankAccount: contaDaBaixaSchema.optional(),
  })
  .strict()

export type CreateEntryFromTransactionInput = z.infer<typeof createEntryFromTransactionInputSchema>

/** Desfazer — RF-080. */
export const undoReconciliationInputSchema = z
  .object({
    transactionId: idSchema,
    reason: z.string().trim().min(3, 'Diga por que esta desfazendo.').max(200),
  })
  .strict()

export type UndoReconciliationInput = z.infer<typeof undoReconciliationInputSchema>

/**
 * A fila da tela — NR-076.
 *
 * Dois recortes e nao um filtro livre: a tela de conciliacao tem exatamente
 * duas perguntas, "o que falta conferir" e "o que ja conferi" (esta segunda so
 * existe para poder desfazer, RF-080). Filtro livre convidaria cada tela a
 * inventar o proprio recorte, e a fila e a mesma para todo mundo.
 */
export const bankTransactionScopeSchema = z.enum(['pending', 'reconciled'])

export type BankTransactionScope = z.infer<typeof bankTransactionScopeSchema>

export const listBankTransactionsInputSchema = z
  .object({ scope: bankTransactionScopeSchema.default('pending') })
  .strict()

export type ListBankTransactionsInput = z.infer<typeof listBankTransactionsInputSchema>

/**
 * O lancamento com que a transacao foi conciliada, resumido.
 *
 * Existe para o desfazer ser uma decisao e nao um salto no escuro: "desfazer a
 * conciliacao de R$ 340,00" nao diz nada, e "desfazer — Energia, Enel, vence
 * 10/03" diz se e essa mesmo. Sao os tres campos que identificam o lancamento
 * para quem lancou, e nada alem.
 */
export const reconciledEntrySummarySchema = z.object({
  kind: entryKindSchema,
  id: idSchema,
  counterparty: z.string(),
  description: z.string(),
  dueDate: dateSchema,
})

export type ReconciledEntrySummary = z.infer<typeof reconciledEntrySummarySchema>

export const bankTransactionListItemSchema = bankTransactionOutputSchema.extend({
  /** Nulo na fila; preenchido no recorte das conciliadas. */
  reconciledWith: reconciledEntrySummarySchema.nullable(),
})

export type BankTransactionListItem = z.infer<typeof bankTransactionListItemSchema>

/* -------------------------------------------------------------------------- */
/* Conciliar da baixa — DEC-026                                               */
/* -------------------------------------------------------------------------- */

/**
 * Um par do casamento automatico: a linha do extrato e o lancamento que o
 * sistema acha que e ela. `suggestion` nulo = nada bate (valor exato, na
 * janela de dias, ainda nao usado por outra linha).
 */
export const autoMatchPairSchema = z.object({
  transaction: bankTransactionOutputSchema,
  suggestion: z
    .object({
      entry: reconciledEntrySummarySchema.extend({
        amountCents: moneyCentsSchema,
        netAmountCents: moneyCentsSchema.nullable(),
      }),
      expectedAmountCents: moneyCentsSchema,
      daysApart: z.number().int().nonnegative(),
      confidencePoints: z.number().int(),
      /** Quantos outros lancamentos tambem batiam — maior que zero pede conferir. */
      alternatives: z.number().int().nonnegative(),
    })
    .nullable(),
})

export type AutoMatchPair = z.infer<typeof autoMatchPairSchema>

/** A fila inteira, casada, NA ORDEM DO EXTRATO. */
export const autoMatchOutputSchema = z.object({ pairs: z.array(autoMatchPairSchema) })

export type AutoMatchOutput = z.infer<typeof autoMatchOutputSchema>

/** No maximo quantos pares por confirmacao — um extrato mensal cabe folgado. */
export const MAX_PARES_POR_CONFIRMACAO = 300

/**
 * Confirmar os pares conferidos — DEC-026.
 *
 * Tudo ou nada: se um par nao fecha (valor mudou, outra aba conciliou), nenhum
 * e gravado, e a mensagem diz qual. Metade das baixas lancada e a outra metade
 * nao deixaria o extrato e as contas fora de ordem — o que a pessoa veio
 * justamente conferir.
 */
export const confirmReconciliationsInputSchema = z
  .object({
    bankAccount: contaDaBaixaSchema,
    pairs: z
      .array(
        z
          .object({ transactionId: idSchema, entryKind: entryKindSchema, entryId: idSchema })
          .strict(),
      )
      .min(1, 'Confirme pelo menos um par.')
      .max(MAX_PARES_POR_CONFIRMACAO, `No máximo ${MAX_PARES_POR_CONFIRMACAO} pares por vez.`),
  })
  .strict()
  .refine((s) => new Set(s.pairs.map((p) => p.transactionId)).size === s.pairs.length, {
    message: 'A mesma linha do extrato aparece em dois pares.',
    path: ['pairs'],
  })
  .refine((s) => new Set(s.pairs.map((p) => p.entryId)).size === s.pairs.length, {
    message: 'O mesmo lançamento aparece em dois pares.',
    path: ['pairs'],
  })

export type ConfirmReconciliationsInput = z.infer<typeof confirmReconciliationsInputSchema>

export const confirmReconciliationsOutputSchema = z.object({
  /** Quantos pares foram conciliados. */
  reconciled: z.number().int().nonnegative(),
  /** Quantos receberam baixa agora (os ja quitados so foram ligados). */
  settled: z.number().int().nonnegative(),
  /** Os pares NA ORDEM EM QUE AS BAIXAS FORAM LANCADAS — a do extrato. */
  order: z.array(
    z.object({
      transactionId: idSchema,
      entryKind: entryKindSchema,
      entryId: idSchema,
      postedOn: dateSchema,
      amountCents: moneyCentsSchema,
      settlementId: idSchema.nullable(),
    }),
  ),
})

export type ConfirmReconciliationsOutput = z.infer<typeof confirmReconciliationsOutputSchema>
