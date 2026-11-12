import { z } from 'zod'
import { dateTimeSchema, idSchema } from '../common/primitives.js'

/**
 * Chamados de suporte — NR-080, US-062.
 *
 * O chamado e a CONVERSA. As mensagens vem separadas porque a equipe responde
 * de fora do app, por um painel proprio — o mesmo motivo de serem duas tabelas.
 */

export const CATEGORIAS_DE_CHAMADO = [
  'financeiro',
  'cadastro',
  'vendas',
  'tecnico',
  'outro',
] as const

export const ticketCategorySchema = z.enum(CATEGORIAS_DE_CHAMADO, {
  error: 'Categoria de chamado invalida.',
})

export type TicketCategory = z.infer<typeof ticketCategorySchema>

export const STATUS_DE_CHAMADO = ['open', 'waiting', 'closed'] as const

export const ticketStatusSchema = z.enum(STATUS_DE_CHAMADO, {
  error: 'Estado de chamado invalido.',
})

export type TicketStatus = z.infer<typeof ticketStatusSchema>

/**
 * Abrir chamado — US-062.
 *
 * Assunto com minimo de verdade: "erro" nao e assunto, e um chamado que chega
 * assim custa uma ida e volta so para descobrir do que se trata. O corpo tem
 * minimo maior pelo mesmo motivo.
 */
export const openTicketInputSchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(5, 'Diga em poucas palavras do que se trata.')
      .max(140, 'Assunto muito longo. O detalhe cabe na mensagem.'),
    category: ticketCategorySchema,
    body: z
      .string()
      .trim()
      .min(10, 'Conte o que aconteceu — quanto mais detalhe, mais rapida a resposta.')
      .max(4000, 'Mensagem muito longa.'),
    attachment: z.string().trim().max(200).optional(),
  })
  .strict()

export type OpenTicketInput = z.infer<typeof openTicketInputSchema>

export const replyToTicketInputSchema = z
  .object({
    ticketId: idSchema,
    body: z.string().trim().min(1, 'Escreva a mensagem.').max(4000, 'Mensagem muito longa.'),
    attachment: z.string().trim().max(200).optional(),
  })
  .strict()

export type ReplyToTicketInput = z.infer<typeof replyToTicketInputSchema>

export const ticketMessageSchema = z.object({
  id: idSchema,
  author: z.enum(['cliente', 'suporte']),
  authorName: z.string(),
  body: z.string(),
  attachment: z.string().nullable(),
  createdAt: dateTimeSchema,
})

export type TicketMessage = z.infer<typeof ticketMessageSchema>

/**
 * Um chamado na lista.
 *
 * `unread` e CONTADO a partir de `lastReadAt`, e nunca guardado. Um contador
 * teria dois donos — o painel do suporte incrementa, o app zera — e divergiria
 * sem que ninguem soubesse qual dos dois errou.
 */
export const ticketSummarySchema = z.object({
  id: idSchema,
  protocol: z.string(),
  subject: z.string(),
  category: ticketCategorySchema,
  status: ticketStatusSchema,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  unread: z.number().int(),
})

export type TicketSummary = z.infer<typeof ticketSummarySchema>

export const ticketDetailSchema = ticketSummarySchema.extend({
  messages: z.array(ticketMessageSchema),
})

export type TicketDetail = z.infer<typeof ticketDetailSchema>

export const ticketListOutputSchema = z.object({
  tickets: z.array(ticketSummarySchema),
  /** Quantos ainda nao foram encerrados — o numero do topo da tela. */
  open: z.number().int(),
  /** Somatorio das nao lidas — o que acende o sino da barra. */
  unread: z.number().int(),
})

export type TicketListOutput = z.infer<typeof ticketListOutputSchema>

/**
 * A fila de chamados da PLATAFORMA — NR-215.
 *
 * Achado do QA: "como enxergaremos os chamados?". A equipe EiBuddy (Super
 * Admin) ve os chamados de todas as lojas, responde como "Suporte" e encerra.
 *
 * A situacao e derivada da ultima mensagem, e nao guardada: "responder" e o
 * que esta com a bola do nosso lado (o cliente falou por ultimo);
 * "aguardando" e o que espera o cliente.
 */
export const SITUACOES_DA_FILA = ['responder', 'aguardando', 'encerrados', 'todos'] as const

export const supportInboxSituationSchema = z.enum(SITUACOES_DA_FILA, {
  error: 'Situacao da fila invalida.',
})

export type SupportInboxSituation = z.infer<typeof supportInboxSituationSchema>

export const supportInboxQuerySchema = z
  .object({
    situation: supportInboxSituationSchema.default('responder'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict()

export type SupportInboxQuery = z.infer<typeof supportInboxQuerySchema>

export const supportInboxItemSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  companyName: z.string(),
  protocol: z.string(),
  subject: z.string(),
  category: ticketCategorySchema,
  status: ticketStatusSchema,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  /** Quem falou por ultimo. Nulo so num chamado sem mensagem nenhuma. */
  lastAuthor: z.enum(['cliente', 'suporte']).nullable(),
  messagesCount: z.number().int(),
})

export type SupportInboxItem = z.infer<typeof supportInboxItemSchema>

export const supportInboxCountsSchema = z.object({
  toAnswer: z.number().int(),
  awaitingCustomer: z.number().int(),
  closed: z.number().int(),
})

export type SupportInboxCounts = z.infer<typeof supportInboxCountsSchema>

export const supportInboxOutputSchema = z.object({
  tickets: z.array(supportInboxItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  counts: supportInboxCountsSchema,
})

export type SupportInboxOutput = z.infer<typeof supportInboxOutputSchema>

export const supportInboxDetailSchema = supportInboxItemSchema.extend({
  messages: z.array(ticketMessageSchema),
})

export type SupportInboxDetail = z.infer<typeof supportInboxDetailSchema>

export const supportReplyInputSchema = z
  .object({
    body: z.string().trim().min(1, 'Escreva a resposta.').max(4000, 'Mensagem muito longa.'),
  })
  .strict()

export type SupportReplyInput = z.infer<typeof supportReplyInputSchema>
