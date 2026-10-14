import { gravarTrilha } from './audit-repository.js'
import type { PayableOutput } from '@na-regua/contracts'
import type {
  NewPayable,
  PayableFilter,
  PayableQueries,
  PayableTransaction,
  PayableUnitOfWork,
} from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Contas a pagar — NR-074, RF-055 a RF-062.
 *
 * `bigint` volta como STRING no postgres.js, para nao perder precisao acima de
 * 2^53. As portas declaram `number`, e string entrando num calculo estoura com
 * "Cannot mix BigInt and other types" — a CI ja mostrou isso no repositorio de
 * vendas. A conversao acontece na BORDA.
 */
const numero = (valor: unknown): number => Number(valor)

type Linha = {
  id: string
  supplier: string
  description: string
  amount_cents: string | number
  settled_amount_cents: string | number
  due_date: Date | string
  status: string
  attachment_key: string | null
  account_id: string | null
  recurrence_id: string | null
  occurrence_number: number | null
  occurrence_count: number | null
  created_at: Date
}

/**
 * O `Date` de uma coluna `date` vira `AAAA-MM-DD`.
 *
 * O postgres.js devolve a coluna como meia-noite **UTC** — `2026-12-01` chega
 * como `2026-12-01T00:00:00.000Z`. Entao os campos a ler sao os UTC.
 *
 * As tres copias desta funcao liam os campos LOCAIS, com um comentario meu
 * afirmando o contrario ("vem a meia-noite local, e converter para UTC pode
 * recuar um dia"). Era o inverso: em fuso negativo, a meia-noite UTC ainda e o
 * dia ANTERIOR no relogio local, e ler campo local e que recuava. Em
 * America/Sao_Paulo, todo vencimento aparecia um dia antes.
 *
 * A CI nunca pegaria: o runner roda em UTC, onde os dois caminhos dao o mesmo
 * resultado. Apareceu ao subir um Postgres na maquina de desenvolvimento.
 */
function paraDia(v: Date | string): string {
  if (typeof v === 'string') return v.slice(0, 10)
  /* Campos UTC. Ver o comentario acima. */
  const mes = String(v.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(v.getUTCDate()).padStart(2, '0')
  return `${v.getUTCFullYear()}-${mes}-${dia}`
}

const paraSaida = (l: Linha): PayableOutput => ({
  id: l.id,
  supplier: l.supplier,
  description: l.description,
  amountCents: numero(l.amount_cents),
  settledAmountCents: numero(l.settled_amount_cents),
  dueDate: paraDia(l.due_date),
  status: l.status as PayableOutput['status'],
  attachmentKey: l.attachment_key,
  accountId: l.account_id,
  recurrenceId: l.recurrence_id,
  occurrenceNumber: l.occurrence_number,
  occurrenceCount: l.occurrence_count,
  createdAt: l.created_at.toISOString(),
})

function escopo(tx: TransactionSql): PayableTransaction {
  return {
    /*
     * A trilha entra NA transacao — NR-087.
     *
     * O INSERT mora em `gravarTrilha`, e nao aqui: duas copias dele
     * divergiriam no primeiro campo novo, e a errada seria a que ninguem le.
     * Fora da transacao, a entrada sobreviveria ao rollback e a trilha passaria
     * a registrar o que nao aconteceu — ver `TransactionalAuditTrail`.
     */
    record: (entrada) => gravarTrilha(tx, entrada),
    /**
     * As ocorrencias de uma vez.
     *
     * Um unico INSERT com varias linhas, e nao um por ocorrencia: doze idas ao
     * banco dentro de uma transacao aberta e lock por doze vezes mais tempo. E
     * o `insertMany` da porta existe justamente porque metade de uma
     * recorrencia gravada e pior que nenhuma.
     */
    insertMany: async (contas: readonly NewPayable[]) => {
      if (contas.length === 0) return []

      const linhas = await tx<Linha[]>`
        INSERT INTO payables ${tx(
          contas.map((c) => ({
            company_id: c.companyId,
            supplier: c.supplier,
            description: c.description,
            amount_cents: c.amountCents,
            due_date: c.dueDate,
            attachment_key: c.attachmentKey,
            account_id: c.accountId,
            recurrence_id: c.recurrenceId,
            occurrence_number: c.occurrenceNumber,
            occurrence_count: c.occurrenceCount,
            created_by: c.createdBy,
            created_at: c.createdAt,
            updated_at: c.createdAt,
          })),
        )}
        RETURNING *
      `
      return linhas.map(paraSaida)
    },

    cancelFutureOccurrences: async (
      _empresa,
      recurrenceId,
      aPartirDe,
      cancelledBy,
      cancelledAt,
    ) => {
      const linhas = await tx<{ id: string }[]>`
        UPDATE payables
        SET status = 'cancelled',
            cancelled_at = ${cancelledAt},
            cancelled_by = ${cancelledBy},
            updated_at = now()
        WHERE recurrence_id = ${recurrenceId}
          AND status = 'open'
          /* Estritamente DEPOIS de hoje: a que vence hoje continua devida — o
             lojista tem o dia inteiro para paga-la. */
          AND due_date > ${aPartirDe}
        RETURNING id
      `
      return linhas.length
    },

    /* `FOR UPDATE`: entre ler "sem baixa" e gravar a correcao, uma baixa
       concorrente nao pode entrar — NR-150. A RLS ja prende a empresa. */
    findById: async (_empresa, id) => {
      const [linha] = await tx<Linha[]>`SELECT * FROM payables WHERE id = ${id} FOR UPDATE`
      return linha === undefined ? null : paraSaida(linha)
    },

    update: async (_empresa, id, mudancas) => {
      const [linha] = await tx<Linha[]>`
        UPDATE payables
        SET supplier = COALESCE(${mudancas.supplier ?? null}, supplier),
            description = COALESCE(${mudancas.description ?? null}, description),
            amount_cents = COALESCE(${mudancas.amountCents ?? null}::bigint, amount_cents),
            due_date = COALESCE(${mudancas.dueDate ?? null}::date, due_date),
            updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `
      return paraSaida(linha!)
    },

    cancel: async (_empresa, id, cancelledBy, cancelledAt) => {
      const [linha] = await tx<Linha[]>`
        UPDATE payables
        SET status = 'cancelled',
            cancelled_at = ${cancelledAt},
            cancelled_by = ${cancelledBy},
            updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `
      return paraSaida(linha!)
    },

    findByRecurrence: async (_empresa, recurrenceId) => {
      const linhas = await tx<Linha[]>`
        SELECT * FROM payables WHERE recurrence_id = ${recurrenceId} ORDER BY due_date
      `
      return linhas.map(paraSaida)
    },
  }
}

export function createPayableUnitOfWork(sql: Sql): PayableUnitOfWork {
  return {
    transaction: (companyId, fn) => withTenant(sql, companyId, (tx) => fn(escopo(tx))),
  }
}

export function createPayableQueries(sql: Sql): PayableQueries {
  return {
    list: async (companyId, filtro: PayableFilter) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          SELECT * FROM payables
          ${
            filtro.status === undefined || filtro.status.length === 0
              ? tx``
              : tx`WHERE status = ANY(${filtro.status as string[]})`
          }
          ORDER BY due_date
        `,
      )
      return linhas.map(paraSaida)
    },
  }
}
