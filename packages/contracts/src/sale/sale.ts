import { z } from 'zod'
import { dateSchema, idSchema, moneyCentsSchema, rateSchema } from '../common/primitives.js'

/**
 * Venda — glossario `Sale`. Documento fechado; nunca `Order` no MVP.
 *
 * Os nomes acompanham `packages/domain` (`SaleItemInput`, `PaymentInput`),
 * mas as formas nao: la o dinheiro ja e `Money`, aqui ainda e centavo cru
 * vindo do JSON. Converter e do `core`, na fronteira entre os dois.
 */

/** Formas aceitas no fechamento — RF-034. */
export const paymentMethodSchema = z.enum(['cash', 'pix', 'debit', 'credit', 'wallet'], {
  error: 'Forma de pagamento invalida.',
})
export type PaymentMethod = z.infer<typeof paymentMethodSchema>

export const cardBrandSchema = z.enum(
  ['visa', 'mastercard', 'elo', 'amex', 'hipercard', 'unknown'],
  { error: 'Bandeira de cartao invalida.' },
)
export type CardBrand = z.infer<typeof cardBrandSchema>

export const saleItemInputSchema = z
  .object({
    productId: idSchema,
    /** Inteiro >= 1. Fracao e do cadastro (`UnitOfMeasure`), nao da venda. */
    quantity: z.number().int('Quantidade precisa ser inteira.').positive('Quantidade minima e 1.'),
    /**
     * Preco praticado, nao o de tabela: o balcao negocia, e a venda tem de
     * registrar o que foi cobrado de fato.
     */
    unitPriceCents: moneyCentsSchema,
    discountCents: moneyCentsSchema.optional(),
  })
  .strict()

export type SaleItemInput = z.infer<typeof saleItemInputSchema>

export const paymentInputSchema = z
  .object({
    method: paymentMethodSchema,
    amountCents: moneyCentsSchema,
    /** So faz sentido em credito. Ausente = a vista. */
    installments: z
      .number()
      .int()
      .min(1, 'Numero de parcelas invalido.')
      .max(21, 'Maximo de 21 parcelas.')
      .optional(),
    /** Ausente no balcao: a maquininha nem sempre informa. */
    brand: cardBrandSchema.optional(),
  })
  .strict()
  .refine((p) => p.method === 'credit' || p.installments === undefined, {
    message: 'Parcelamento so vale para credito.',
    path: ['installments'],
  })

export type PaymentInput = z.infer<typeof paymentInputSchema>

export const createSaleInputSchema = z
  .object({
    /** Ausente = venda sem cliente, que e a maioria no balcao. */
    customerId: idSchema.optional(),
    items: z
      .array(saleItemInputSchema)
      .min(1, 'A venda precisa de ao menos um item.')
      .max(200, 'Venda com itens demais. Divida em duas.'),
    payments: z.array(paymentInputSchema).min(1, 'Informe ao menos uma forma de pagamento.'),
    /** Desconto no total, alem dos descontos por item. */
    discountCents: moneyCentsSchema.optional(),
    surchargeRate: rateSchema.optional(),
    notes: z.string().trim().max(500, 'Observacao muito longa.').optional(),
  })
  .strict()
  .refine((s) => s.payments.every((p) => p.method !== 'wallet') || s.customerId !== undefined, {
    /* Fiado sem cliente e divida de ninguem. */
    message: 'Venda no fiado exige cliente identificado.',
    path: ['customerId'],
  })

export type CreateSaleInput = z.infer<typeof createSaleInputSchema>

export const saleOutputSchema = z.object({
  id: idSchema,
  number: z.number().int(),
  customerId: idSchema.nullable(),
  status: z.enum(['open', 'settled', 'cancelled', 'returned']),
  grossAmountCents: z.number().int(),
  discountCents: z.number().int(),
  taxAmountCents: z.number().int(),
  cardFeeAmountCents: z.number().int(),
  netAmountCents: z.number().int(),
  createdAt: z.string(),
})

export type SaleOutput = z.infer<typeof saleOutputSchema>

/**
 * Historico de vendas — NR-027, US-021.
 *
 * Periodo opcional, ao contrario do DRE e dos relatorios: la o periodo E a
 * pergunta ("como fechou marco"), e um padrao escondido faria telas discordarem
 * no dia 1. Aqui a pergunta e "o que eu vendi", e a resposta natural comeca
 * pelas mais recentes — abrir a tela pedindo duas datas antes de mostrar
 * qualquer coisa seria trabalho antes da resposta.
 */
export const PAGINA_PADRAO_DO_HISTORICO = 20
export const PAGINA_MAXIMA_DO_HISTORICO = 100

export const saleHistoryInputSchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    /** Numero da venda, nome do cliente ou descricao de item. */
    q: z.string().trim().max(120).optional(),
    /** So as vendas deste cliente — a ficha do cliente (RF-011). */
    customerId: idSchema.optional(),
    page: z.coerce.number().int().min(1, 'A primeira pagina e a 1.').default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(PAGINA_MAXIMA_DO_HISTORICO, `A pagina vai ate ${PAGINA_MAXIMA_DO_HISTORICO} vendas.`)
      .default(PAGINA_PADRAO_DO_HISTORICO),
  })
  .strict()
  .refine((p) => p.from === undefined || p.to === undefined || p.from <= p.to, {
    message: 'O inicio do periodo nao pode ser depois do fim.',
    path: ['from'],
  })

export type SaleHistoryInput = z.infer<typeof saleHistoryInputSchema>

export const saleHistoryItemSchema = z.object({
  /** Nulo no item avulso, sem produto — esse nao se devolve por produto. */
  productId: idSchema.nullable(),
  description: z.string(),
  quantity: z.number().int(),
  /** Ja devolvido — RF-044. A tela oferece devolver `quantity - returnedQuantity`. */
  returnedQuantity: z.number().int(),
  unitPriceCents: z.number().int(),
  totalCents: z.number().int(),
})

export const saleHistoryPaymentSchema = z.object({
  method: paymentMethodSchema,
  amountCents: z.number().int(),
  installments: z.number().int().nullable(),
})

export const saleHistoryEntrySchema = z.object({
  id: idSchema,
  number: z.number().int(),
  soldAt: z.string(),
  customerId: idSchema.nullable(),
  /** `null` na venda de balcao sem identificacao — RF-033. */
  customerName: z.string().nullable(),
  status: z.enum(['open', 'settled', 'cancelled', 'returned']),
  grossAmountCents: z.number().int(),
  discountCents: z.number().int(),
  netAmountCents: z.number().int(),
  taxAmountCents: z.number().int(),
  cardFeeAmountCents: z.number().int(),
  /** Quanto ja foi devolvido ao cliente — RF-044. O bruto nao muda. */
  returnedAmountCents: z.number().int(),
  items: z.array(saleHistoryItemSchema),
  payments: z.array(saleHistoryPaymentSchema),
  invoiceNumber: z.number().int().nullable(),
  invoiceAccessKey: z.string().nullable(),
})

export type SaleHistoryEntry = z.infer<typeof saleHistoryEntrySchema>

/**
 * Os numeros do topo da tela, sobre o FILTRO inteiro e nao sobre a pagina.
 *
 * Somados no navegador a partir das 20 vendas carregadas, dariam um
 * faturamento vinte vezes menor que o real assim que o historico passasse de
 * uma pagina — e um numero que parece certo e o pior tipo de errado.
 *
 * Venda cancelada fica fora de todos eles: ela nao aconteceu.
 */
export const saleHistorySummarySchema = z.object({
  /** Quantas vendas nao canceladas casam com o filtro. */
  salesCount: z.number().int(),
  grossCents: z.number().int(),
  netCents: z.number().int(),
  cardFeeCents: z.number().int(),
  /** `netCents` menos a tarifa de cartao — o que de fato entra. */
  netAfterFeesCents: z.number().int(),
  /** Nulo quando nao houve venda no filtro — nao zero. */
  averageTicketCents: z.number().int().nullable(),
})

export type SaleHistorySummary = z.infer<typeof saleHistorySummarySchema>

export const saleHistoryOutputSchema = z.object({
  sales: z.array(saleHistoryEntrySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  summary: saleHistorySummarySchema,
})

export type SaleHistoryOutput = z.infer<typeof saleHistoryOutputSchema>

/**
 * Cancelamento de venda — RF-043.
 *
 * `reason` e OBRIGATORIO aqui, ao contrario do cancelamento de compromisso:
 * a US-021 pede que fique registrado quem, quando e **por que**, e venda
 * cancelada sem motivo e a linha que ninguem consegue explicar no fechamento
 * do mes.
 */
export const cancelSaleInputSchema = z
  .object({
    saleId: idSchema,
    reason: z
      .string()
      .trim()
      .min(3, 'Diga o motivo do cancelamento.')
      .max(280, 'Motivo muito longo.'),
  })
  .strict()

export type CancelSaleInput = z.infer<typeof cancelSaleInputSchema>

/**
 * Devolucao parcial — RF-044, NR-122.
 *
 * Diz QUAIS produtos voltam e quantos. O valor nao vem da tela: quem calcula e
 * o servidor, proporcional ao que foi cobrado por item — mandar o valor daqui
 * seria deixar a tela decidir quanto dinheiro sai do caixa.
 */
export const returnSaleItemsInputSchema = z
  .object({
    saleId: idSchema,
    reason: z.string().trim().min(3, 'Diga o motivo da devolução.').max(280, 'Motivo muito longo.'),
    items: z
      .array(
        z
          .object({
            productId: idSchema,
            quantity: z
              .number()
              .int()
              .positive('A quantidade devolvida precisa ser maior que zero.'),
          })
          .strict(),
      )
      .min(1, 'Escolha ao menos um item para devolver.')
      .max(200),
  })
  .strict()

export type ReturnSaleItemsInput = z.infer<typeof returnSaleItemsInputSchema>

/** O que a devolucao fez com o dinheiro. */
export const saleReturnOutputSchema = z.object({
  /** O valor devolvido, somado dos itens. */
  refundCents: z.number().int(),
  /**
   * A parte que JA tinha entrado (dinheiro, Pix, cartao a receber liquidado):
   * sai do caixa e volta para a mao do cliente.
   */
  paidBackCents: z.number().int(),
  /** A parte que ainda estava em aberto (fiado, parcelas, cartao a receber): deixa de ser recebida. */
  uncollectedCents: z.number().int(),
  /** `returned` quando nao sobrou nada da venda. */
  status: z.enum(['open', 'settled', 'returned']),
})

export type SaleReturnOutput = z.infer<typeof saleReturnOutputSchema>
