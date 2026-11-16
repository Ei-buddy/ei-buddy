import { z } from 'zod'
import { dateSchema, idSchema, moneyCentsSchema } from '../common/primitives.js'

/**
 * Orcamento — NR-159.
 *
 * Proposta ao cliente que nao baixa estoque nem gera financeiro. Os precos
 * ficam gravados: o prometido nao muda com a tabela. Aceito, vira venda pelo
 * PDV, e o orcamento guarda a venda que nasceu dele.
 */

export const quoteStatusSchema = z.enum(['open', 'converted', 'cancelled'])

export type QuoteStatus = z.infer<typeof quoteStatusSchema>

export const quoteItemInputSchema = z
  .object({
    productId: idSchema,
    quantity: z
      .number()
      .int('A quantidade deve ser um numero inteiro.')
      .min(1, 'A quantidade deve ser maior que zero.')
      .max(100_000, 'Quantidade alta demais. Confira o numero.'),
    unitPriceCents: moneyCentsSchema,
  })
  .strict()

/*
 * O cliente e obrigatorio e vem do cadastro — achado do QA. O nome solto de
 * antes nao chegava a venda: o PDV pedia o cliente de novo, e "Joao" e "joao
 * da silva" viravam duas pessoas. O nome gravado sai do cadastro, no servidor.
 */
const quoteFieldsSchema = z
  .object({
    customerId: idSchema,
    items: z
      .array(quoteItemInputSchema)
      .min(1, 'Inclua pelo menos um produto.')
      .max(200, 'Orcamento com itens demais.')
      .refine((itens) => new Set(itens.map((i) => i.productId)).size === itens.length, {
        message: 'O mesmo produto aparece duas vezes. Junte as quantidades numa linha.',
      }),
    validUntil: dateSchema,
    discountCents: moneyCentsSchema.optional(),
    notes: z.string().trim().max(500, 'Observacao muito longa.').optional(),
  })
  .strict()

export const createQuoteInputSchema = quoteFieldsSchema

export type CreateQuoteInput = z.infer<typeof createQuoteInputSchema>

/**
 * Edicao do orcamento ABERTO — achado do QA ("o abrir do orcamento deveria
 * permitir o editar"). Substitui tudo: cliente, itens, validade, desconto e
 * observacao. Convertido ou cancelado nao muda — ja virou venda ou foi
 * recusado, e o registro e o que foi proposto.
 */
export const updateQuoteInputSchema = quoteFieldsSchema

export type UpdateQuoteInput = z.infer<typeof updateQuoteInputSchema>

export const convertQuoteInputSchema = z.object({ saleId: idSchema }).strict()

export type ConvertQuoteInput = z.infer<typeof convertQuoteInputSchema>

export const quoteItemOutputSchema = z.object({
  productId: idSchema,
  description: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  /** Dados ATUAIS do produto, para o PDV montar o carrinho ao converter. */
  code: z.string(),
  costPriceCents: z.number().int(),
  stock: z.number().int(),
  isActive: z.boolean(),
})

export type QuoteItemOutput = z.infer<typeof quoteItemOutputSchema>

export const quoteOutputSchema = z.object({
  id: idSchema,
  number: z.number().int(),
  /** Nulo nos orcamentos anteriores ao cadastro obrigatorio, que so tinham o nome. */
  customerId: idSchema.nullable(),
  customerName: z.string().nullable(),
  status: quoteStatusSchema,
  validUntil: z.string(),
  notes: z.string().nullable(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
  saleId: idSchema.nullable(),
  /** O numero da venda que nasceu dele — para "Ver venda #N" (NR-172). */
  saleNumber: z.number().int().nullable(),
  items: z.array(quoteItemOutputSchema),
  createdAt: z.string(),
})

export type QuoteOutput = z.infer<typeof quoteOutputSchema>

/**
 * A lista com busca, periodo, situacao e o painel — achado do QA ("deve ter
 * um painel, como na venda, do total de orcamentos em aberto, como tambem um
 * filtro de busca como ha na venda").
 *
 * Antes a tela recebia os 100 mais recentes e mais nada: um total somado ali
 * deixaria de fora os orcamentos abertos mais antigos. Agora busca, periodo e
 * paginas sao do servidor, e o RESUMO vem sobre o filtro inteiro — como no
 * historico de vendas.
 *
 * "Vencido" nao e um status gravado: e o aberto cuja validade ja passou, no
 * dia da loja. Por isso a situacao tem quatro valores e o status tres.
 */
export const quoteSituationSchema = z.enum(['open', 'expired', 'converted', 'cancelled'])

export type QuoteSituation = z.infer<typeof quoteSituationSchema>

export const PAGINA_PADRAO_DE_ORCAMENTOS = 20
export const PAGINA_MAXIMA_DE_ORCAMENTOS = 100

export const quoteListInputSchema = z
  .object({
    /** Numero do orcamento, nome do cliente ou descricao de item. */
    q: z.string().trim().max(120).optional(),
    /** Recorta a LISTA; o resumo continua mostrando todas as situacoes. */
    situation: quoteSituationSchema.optional(),
    /** Dia em que o orcamento foi feito, no fuso da loja. */
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    page: z.coerce.number().int().min(1, 'A primeira pagina e a 1.').default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(
        PAGINA_MAXIMA_DE_ORCAMENTOS,
        `A pagina vai ate ${PAGINA_MAXIMA_DE_ORCAMENTOS} orcamentos.`,
      )
      .default(PAGINA_PADRAO_DE_ORCAMENTOS),
  })
  .strict()
  .refine((p) => p.from === undefined || p.to === undefined || p.from <= p.to, {
    message: 'O inicio do periodo nao pode ser depois do fim.',
    path: ['from'],
  })

export type QuoteListInput = z.infer<typeof quoteListInputSchema>

const quoteTotalSchema = z.object({
  count: z.number().int(),
  totalCents: z.number().int(),
})

export type QuoteTotal = z.infer<typeof quoteTotalSchema>

/** Quantos e quanto em cada situacao, sobre a busca e o periodo. */
export const quoteListSummarySchema = z.object({
  open: quoteTotalSchema,
  expired: quoteTotalSchema,
  converted: quoteTotalSchema,
  cancelled: quoteTotalSchema,
})

export type QuoteListSummary = z.infer<typeof quoteListSummarySchema>

export const quoteListOutputSchema = z.object({
  quotes: z.array(quoteOutputSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  summary: quoteListSummarySchema,
})

export type QuoteListOutput = z.infer<typeof quoteListOutputSchema>
