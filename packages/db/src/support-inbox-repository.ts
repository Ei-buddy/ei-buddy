import type {
  SupportInboxDetail,
  SupportInboxItem,
  TicketCategory,
  TicketStatus,
} from '@na-regua/contracts'
import type { SupportInbox } from '@na-regua/core'
import type { Sql } from 'postgres'

/**
 * A fila de chamados da plataforma no banco — NR-215.
 *
 * Tudo passa pelas funcoes `platform_support_*` da migration 0048: elas
 * conferem Super Admin la dentro antes de atravessar empresas. Este arquivo
 * nao faz SELECT direto em `support_tickets` — o papel da aplicacao nao
 * enxerga outra loja, e assim continua.
 */

const ehUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

type LinhaDaFila = {
  id: string
  company_id: string
  company_name: string
  protocol: string
  subject: string
  category: string
  status: string
  created_at: Date
  updated_at: Date
  last_author: string | null
  messages_count: string | number
  total_geral: string | number
}

type LinhaDoChamado = Omit<LinhaDaFila, 'last_author' | 'messages_count' | 'total_geral'>

type LinhaDaMensagem = {
  id: string
  author: string
  author_name: string
  body: string
  attachment: string | null
  created_at: Date
}

const paraItem = (l: LinhaDaFila): SupportInboxItem => ({
  id: l.id,
  companyId: l.company_id,
  companyName: l.company_name,
  protocol: l.protocol,
  subject: l.subject,
  category: l.category as TicketCategory,
  status: l.status as TicketStatus,
  createdAt: l.created_at.toISOString(),
  updatedAt: l.updated_at.toISOString(),
  lastAuthor: l.last_author === null ? null : (l.last_author as 'cliente' | 'suporte'),
  messagesCount: Number(l.messages_count),
})

export function createSupportInboxRepository(sql: Sql): SupportInbox {
  return {
    counts: async (requestedBy) => {
      const [l] = await sql<{ responder: string; aguardando: string; encerrados: string }[]>`
        SELECT * FROM platform_support_counts(${requestedBy})
      `
      return {
        toAnswer: Number(l?.responder ?? 0),
        awaitingCustomer: Number(l?.aguardando ?? 0),
        closed: Number(l?.encerrados ?? 0),
      }
    },

    list: async (requestedBy, f) => {
      const linhas = await sql<LinhaDaFila[]>`
        SELECT * FROM platform_support_list(${requestedBy}, ${f.situacao}, ${f.limite}, ${f.offset})
      `
      return { tickets: linhas.map(paraItem), total: Number(linhas[0]?.total_geral ?? 0) }
    },

    find: async (requestedBy, ticketId) => {
      if (!ehUuid(ticketId)) return undefined
      const [c] = await sql<LinhaDoChamado[]>`
        SELECT * FROM platform_support_ticket(${requestedBy}, ${ticketId})
      `
      if (c === undefined) return undefined
      const mensagens = await sql<LinhaDaMensagem[]>`
        SELECT * FROM platform_support_messages(${requestedBy}, ${ticketId})
      `
      const detalhe: SupportInboxDetail = {
        ...paraItem({
          ...c,
          last_author: mensagens.at(-1)?.author ?? null,
          messages_count: mensagens.length,
          total_geral: 1,
        }),
        messages: mensagens.map((m) => ({
          id: m.id,
          author: m.author as 'cliente' | 'suporte',
          authorName: m.author_name,
          body: m.body,
          attachment: m.attachment,
          createdAt: m.created_at.toISOString(),
        })),
      }
      return detalhe
    },

    reply: async (requestedBy, ticketId, body) => {
      if (!ehUuid(ticketId)) return false
      const [l] = await sql<{ ok: boolean }[]>`
        SELECT platform_support_reply(${requestedBy}, ${ticketId}, ${body}) AS ok
      `
      return l?.ok === true
    },

    close: async (requestedBy, ticketId) => {
      if (!ehUuid(ticketId)) return false
      const [l] = await sql<{ ok: boolean }[]>`
        SELECT platform_support_close(${requestedBy}, ${ticketId}) AS ok
      `
      return l?.ok === true
    },
  }
}
