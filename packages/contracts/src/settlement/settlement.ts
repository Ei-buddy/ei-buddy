import { z } from 'zod'
import { dateSchema, idSchema, moneyCentsSchema } from '../common/primitives.js'
import { paymentMethodSchema } from '../sale/sale.js'

/** Baixa, baixa parcial e estorno — RF-059, RF-060, RF-066, RF-067. */

/**
 * Baixa de conta a pagar — RF-059.
 *
 * `settledOn` e `bankAccount` sao exigidos pelo requisito, e os dois pelo mesmo
 * motivo: a baixa existe para casar com o extrato. Uma baixa sem data cai no
 * dia em que alguem lembrou de lancar, e sem conta bancaria nao da para
 * conciliar quando a loja tem mais de uma.
 */
export const settlePayableInputSchema = z
  .object({
    payableId: idSchema,
    /** Parcial e o caso normal, nao a excecao — RF-059. */
    amountCents: moneyCentsSchema.min(1, 'A baixa precisa ter valor.'),
    settledOn: dateSchema,
    bankAccount: z.string().trim().min(1, 'Informe a conta bancaria.').max(140),
    notes: z.string().trim().max(280).optional(),
  })
  .strict()

export type SettlePayableInput = z.infer<typeof settlePayableInputSchema>

/** Baixa de recebivel — RF-066. */
export const settleReceivableInputSchema = z
  .object({
    receivableId: idSchema,
    amountCents: moneyCentsSchema.min(1, 'A baixa precisa ter valor.'),
    /** Como o dinheiro entrou. Nao e o metodo da venda — e o do recebimento. */
    method: paymentMethodSchema,
    settledOn: dateSchema,
    /**
     * Onde o dinheiro entrou — RF-073. Opcional: o dinheiro na gaveta nao tem
     * conta, mas o Pix que caiu no banco tem, e sem ela o saldo da conta so
     * desceria (os pagamentos ja dizem de onde sairam).
     */
    bankAccount: z.string().trim().min(1).max(140).optional(),
    notes: z.string().trim().max(280).optional(),
  })
  .strict()

export type SettleReceivableInput = z.infer<typeof settleReceivableInputSchema>

/**
 * Estorno — RF-060, RF-067.
 *
 * Aponta para a BAIXA, e nao para o titulo: um titulo pode ter varias baixas, e
 * "estornar o titulo" seria ambiguo justamente no caso em que estornar importa.
 */
export const reverseSettlementInputSchema = z
  .object({
    settlementId: idSchema,
    reason: z.string().trim().min(3, 'Diga o motivo do estorno.').max(280),
  })
  .strict()

export type ReverseSettlementInput = z.infer<typeof reverseSettlementInputSchema>

export const settlementOutputSchema = z.object({
  id: idSchema,
  /** Um dos dois esta preenchido, nunca os dois. */
  payableId: idSchema.nullable(),
  receivableId: idSchema.nullable(),
  /** Negativo quando e estorno — a soma das linhas e o saldo baixado. */
  amountCents: z.number().int(),
  method: paymentMethodSchema.nullable(),
  bankAccount: z.string().nullable(),
  settledOn: z.string(),
  notes: z.string().nullable(),
  /** Preenchido no estorno, apontando a baixa desfeita. */
  reversesId: idSchema.nullable(),
  /**
   * Anulavel porque a COLUNA e anulavel: `created_by` e `ON DELETE SET NULL`
   * em `settlements`.
   *
   * Toda baixa nasce com autor. O nulo aparece depois, quando a pessoa que deu
   * a baixa sai da empresa e o cadastro dela e removido. Prometer nao-anulavel
   * aqui obrigaria o repositorio a inventar um valor — e string vazia nao e id.
   *
   * (Difere da trilha de estoque, onde a coluna virou NOT NULL sem FK: la o
   * gatilho de imutabilidade impedia o proprio SET NULL de acontecer, e aqui
   * ele acontece.)
   */
  createdBy: idSchema.nullable(),
  createdAt: z.string(),
})

export type SettlementOutput = z.infer<typeof settlementOutputSchema>
