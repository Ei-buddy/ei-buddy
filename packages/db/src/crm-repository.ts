import type { CrmCardOutput, CrmCommentOutput } from '@na-regua/contracts'
import type { CrmRepository, NewCrmCard, NewCrmComment } from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * O quadro de CRM — NR-109.
 *
 * Modulo inteiro novo (migration 0011): nao havia tabela, porta nem rota. A
 * tela montava o quadro a partir de `mock-data`, e criar card, mover coluna e
 * comentar nao gravavam nada.
 *
 * Comentarios vem AGREGADOS por `json_agg` num `LATERAL`, e nao numa segunda
 * consulta por card — mesma razao de `sale-history-repository`: um quadro tem
 * dezenas de cards, e buscar comentario por card daria dezenas de idas ao
 * banco para abrir a tela.
 */

type LinhaCard = {
  id: string
  title: string
  description: string | null
  kind: string
  column_status: string
  customer_id: string | null
  customer_name: string | null
  due_on: string
  assignee_user_id: string | null
  assignee_name: string | null
  created_at: Date
  comentarios: {
    id: string
    author_id: string | null
    author_name: string | null
    text: string
    created_at: string
  }[]
}

const paraCard = (l: LinhaCard): CrmCardOutput => ({
  id: l.id,
  title: l.title,
  description: l.description,
  kind: l.kind as CrmCardOutput['kind'],
  column: l.column_status as CrmCardOutput['column'],
  customerId: l.customer_id,
  customerName: l.customer_name,
  /* `due_on` e `date`: o driver devolveria meia-noite UTC, que em
     America/Sao_Paulo formata para o dia ANTERIOR. Ver a nota abaixo — a
     coluna sai da consulta ja como texto, via `to_char`. */
  dueOn: l.due_on,
  assigneeUserId: l.assignee_user_id,
  assigneeName: l.assignee_name,
  /* `json_agg` sobre conjunto vazio devolve NULL, e nao `[]`. */
  comments: (l.comentarios ?? []).map((c): CrmCommentOutput => ({
    id: c.id,
    authorId: c.author_id,
    authorName: c.author_name,
    text: c.text,
    createdAt: new Date(c.created_at).toISOString(),
  })),
  createdAt: l.created_at.toISOString(),
})

const ehUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export function createCrmRepository(sql: Sql): CrmRepository {
  const colunas = (tx: TransactionSql) => tx`
    cc.id, cc.title, cc.description, cc.kind, cc.column_status,
    cc.customer_id, cu.name AS customer_name,
    to_char(cc.due_on, 'YYYY-MM-DD') AS due_on,
    cc.assignee_user_id, au.name AS assignee_name,
    cc.created_at, cm.comentarios
  `

  const filhos = (tx: TransactionSql) => tx`
    LEFT JOIN customers cu ON cu.id = cc.customer_id
    LEFT JOIN users au ON au.id = cc.assignee_user_id
    LEFT JOIN LATERAL (
      SELECT json_agg(
               json_build_object(
                 'id', c.id,
                 'author_id', c.author_id,
                 'author_name', u.name,
                 'text', c.text,
                 'created_at', c.created_at
               ) ORDER BY c.created_at, c.id
             ) AS comentarios
      FROM crm_card_comments c
      LEFT JOIN users u ON u.id = c.author_id
      WHERE c.card_id = cc.id
    ) cm ON true
  `

  return {
    create: async (card: NewCrmCard) => {
      const [linha] = await withTenant(
        sql,
        card.companyId,
        (tx) => tx<LinhaCard[]>`
          INSERT INTO crm_cards
            (company_id, title, description, kind, customer_id, due_on,
             assignee_user_id, created_by, created_at)
          VALUES (${card.companyId}, ${card.title}, ${card.description ?? null}, ${card.kind},
                  ${card.customerId ?? null}, ${card.dueOn},
                  ${card.assigneeUserId ?? null}, ${card.createdBy}, ${card.createdAt})
          RETURNING id, title, description, kind, column_status, customer_id, null AS customer_name,
                    to_char(due_on, 'YYYY-MM-DD') AS due_on, assignee_user_id,
                    null AS assignee_name, created_at, null AS comentarios
        `,
      )
      /*
       * O INSERT nao junta cliente/responsavel/comentarios — um card recem
       * criado nunca tem comentario, e o nome do cliente/responsavel, quando
       * existem, sao lidos de novo com o SELECT completo: mais simples que
       * repetir os dois LEFT JOIN no RETURNING, e o custo e uma consulta a
       * mais so na criacao, nao em toda leitura do quadro.
       */
      if (linha!.customer_id === null && linha!.assignee_user_id === null) {
        return paraCard(linha!)
      }
      const [completa] = await withTenant(
        sql,
        card.companyId,
        (tx) => tx<LinhaCard[]>`
          SELECT ${colunas(tx)} FROM crm_cards cc ${filhos(tx)} WHERE cc.id = ${linha!.id}
        `,
      )
      return paraCard(completa!)
    },

    list: async (companyId) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaCard[]>`
          SELECT ${colunas(tx)}
          FROM crm_cards cc
          ${filhos(tx)}
          ORDER BY cc.created_at DESC
        `,
      )
      return linhas.map(paraCard)
    },

    findById: async (companyId, cardId) => {
      /* Id que nao e uuid nao existe: "nao encontrado", e nao um 500 do Postgres. */
      if (!ehUuid(cardId)) return undefined
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaCard[]>`
          SELECT ${colunas(tx)} FROM crm_cards cc ${filhos(tx)} WHERE cc.id = ${cardId}
        `,
      )
      return linha === undefined ? undefined : paraCard(linha)
    },

    /* Os comentarios saem junto pelo CASCADE de `crm_card_comments.card_id`. */
    delete: async (companyId, cardId) => {
      if (!ehUuid(cardId)) return false
      const apagados = await withTenant(
        sql,
        companyId,
        (tx) => tx`
          DELETE FROM crm_cards WHERE company_id = ${companyId} AND id = ${cardId} RETURNING id
        `,
      )
      return apagados.length > 0
    },

    move: async (companyId, cardId, column) => {
      await withTenant(
        sql,
        companyId,
        (tx) => tx`
          UPDATE crm_cards SET column_status = ${column}, updated_at = now() WHERE id = ${cardId}
        `,
      )
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaCard[]>`
          SELECT ${colunas(tx)} FROM crm_cards cc ${filhos(tx)} WHERE cc.id = ${cardId}
        `,
      )
      if (linha === undefined) {
        throw new Error(`card ${cardId} nao encontrado para a empresa ${companyId}`)
      }
      return paraCard(linha)
    },

    addComment: async (comment: NewCrmComment) => {
      const [linha] = await withTenant(
        sql,
        comment.companyId,
        (tx) => tx<{ id: string; created_at: Date }[]>`
          INSERT INTO crm_card_comments (company_id, card_id, author_id, text, created_at)
          VALUES (${comment.companyId}, ${comment.cardId}, ${comment.authorId}, ${comment.text},
                  ${comment.createdAt})
          RETURNING id, created_at
        `,
      )
      /* O INSERT so devolve id/created_at; o nome do autor vem de uma leitura
         curta, pelo mesmo motivo do create() de card acima. */
      const [autor] = await withTenant(
        sql,
        comment.companyId,
        (tx) =>
          tx<{ name: string | null }[]>`SELECT name FROM users WHERE id = ${comment.authorId}`,
      )

      const resultado: CrmCommentOutput = {
        id: linha!.id,
        authorId: comment.authorId,
        authorName: autor?.name ?? null,
        text: comment.text,
        createdAt: linha!.created_at.toISOString(),
      }
      return resultado
    },
  }
}
