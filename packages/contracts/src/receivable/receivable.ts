import { z } from 'zod'
import { idSchema } from '../common/primitives.js'

/**
 * Conta a receber — glossario `Receivable`. RF-064, RF-065, RF-066.
 *
 * Espelha `payable` de proposito, mas NAO e o mesmo tipo. As duas listas
 * respondem perguntas simetricas e guardam coisas diferentes:
 *
 * - a pagar tem `supplier` em texto livre e conta do plano; a receber tem
 *   `customerId`, porque o cliente e cadastro e o fiado dele depende disso;
 * - a receber tem bruto E liquido (RF-063): o que cai na conta ja sem a tarifa
 *   da adquirente. Guardar so o bruto obrigaria a recalcular a tarifa na
 *   leitura, com a tabela de hoje sobre venda de ontem;
 * - a receber tem parcela N de M, que credito parcelado cria e conta a pagar
 *   nao tem.
 *
 * Unir os dois num tipo so significaria metade dos campos nulos em cada uso.
 */

export const receivableStatusSchema = z.enum(['open', 'partially_settled', 'settled', 'cancelled'])

export type ReceivableStatus = z.infer<typeof receivableStatusSchema>

export const receivableOutputSchema = z.object({
  id: idSchema,
  /** Nulo em recebivel avulso (RF-065), que nao vem de venda. */
  saleId: idSchema.nullable(),
  customerId: idSchema.nullable(),
  /**
   * O nome do cliente, junto.
   *
   * Vem na mesma consulta e nao numa segunda chamada: a lista mostra o nome em
   * toda linha, e busca-lo por recebivel daria uma ida ao banco por linha.
   * Nulo quando a venda foi sem identificar o cliente, que o balcao permite.
   */
  customerName: z.string().nullable(),
  description: z.string(),
  /** Bruto. */
  amountCents: z.number().int(),
  /** Liquido previsto: o que cai na conta ja sem a tarifa — RF-063. */
  netAmountCents: z.number().int(),
  settledAmountCents: z.number().int(),
  dueDate: z.string(),
  /** Parcela N de M, em credito parcelado — RF-038. */
  installmentNumber: z.number().int(),
  installmentCount: z.number().int(),
  status: receivableStatusSchema,
  createdAt: z.string(),
})

export type ReceivableOutput = z.infer<typeof receivableOutputSchema>

/** Filtro da lista de contas a receber: `?cliente=` traz so as pendencias dele. */
export const receivablesFilterSchema = z
  .object({
    cliente: idSchema.optional(),
  })
  .strict()

export type ReceivablesFilter = z.infer<typeof receivablesFilterSchema>
