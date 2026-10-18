import type { AppointmentOutput } from '@na-regua/contracts'
import type { AppointmentRepository, NewAppointment } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Implementacao da `AppointmentRepository` — NR-036, RF-089 a RF-093.
 *
 * A seta aponta para dentro: `core` declara a porta, `db` implementa. Cada
 * metodo abre a propria transacao com `withTenant`, e nao ha `UnitOfWork` aqui
 * como em vendas — a agenda nao tem operacao que precise gravar em duas tabelas
 * de uma vez. Inventar a unidade de trabalho antes de existir o caso que a
 * exige e complexidade que ninguem paga.
 *
 * O `companyId` viaja em toda assinatura por decisao da porta: o isolamento
 * nao pode depender de quem chama lembrar de filtrar. Aqui ele vira
 * `app.company_id` e a politica de RLS faz o resto — o `WHERE` explicito nas
 * consultas e cinto sobre suspensorio, e serve para a consulta usar o indice
 * `appointments_por_periodo`, que comeca por `company_id`.
 */

type Linha = {
  id: string
  title: string
  starts_at: Date
  ends_at: Date | null
  location: string | null
  customer_id: string | null
  notes: string | null
  reminder_minutes_before: number | null
  status: string
  created_at: Date
}

/**
 * `timestamptz` volta como `Date` no postgres.js; o contrato pede texto ISO.
 *
 * A conversao acontece na BORDA, e nao no meio do caso de uso — a mesma regra
 * que o `sale-unit-of-work` aplica ao `bigint`. Sem isso, o que a api serializa
 * depende de como o driver decidiu representar a coluna.
 */
const paraSaida = (l: Linha): AppointmentOutput => ({
  id: l.id,
  title: l.title,
  startsAt: l.starts_at.toISOString(),
  /* Nulo continua nulo: "pontual" e um valor, e nao um campo faltando. */
  endsAt: l.ends_at?.toISOString() ?? null,
  location: l.location,
  customerId: l.customer_id,
  notes: l.notes,
  reminderMinutesBefore: l.reminder_minutes_before,
  status: l.status as AppointmentOutput['status'],
  createdAt: l.created_at.toISOString(),
})

export function createAppointmentRepository(sql: Sql): AppointmentRepository {
  return {
    save: async (a: NewAppointment) => {
      const [linha] = await withTenant(
        sql,
        a.companyId,
        (tx) => tx<Linha[]>`
          INSERT INTO appointments
            (company_id, title, starts_at, ends_at, location, customer_id, notes,
             reminder_minutes_before, created_by, created_at)
          VALUES (
            ${a.companyId}, ${a.title}, ${a.startsAt}, ${a.endsAt ?? null},
            ${a.location ?? null}, ${a.customerId ?? null},
            ${a.notes ?? null}, ${a.reminderMinutesBefore ?? null},
            ${a.createdBy}, ${a.createdAt}
          )
          RETURNING *
        `,
      )
      return paraSaida(linha!)
    },

    findById: async (companyId, id) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`SELECT * FROM appointments WHERE id = ${id}`,
      )
      /* `undefined` cobre "nao existe" E "e de outra empresa": a politica de
         RLS ja tirou a linha da vizinha do resultado, e o caso de uso responde
         404 nos dois casos — 403 confirmaria que o id existe. */
      return linha === undefined ? undefined : paraSaida(linha)
    },

    update: async (companyId, id, m) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          UPDATE appointments
          SET title = ${m.title},
              starts_at = ${m.startsAt},
              ends_at = ${m.endsAt ?? null},
              location = ${m.location ?? null},
              customer_id = ${m.customerId ?? null},
              notes = ${m.notes ?? null},
              reminder_minutes_before = ${m.reminderMinutesBefore ?? null},
              updated_at = now()
          WHERE id = ${id}
          RETURNING *
        `,
      )
      if (linha === undefined) throw new Error(`Compromisso ${id} nao encontrado para editar.`)
      return paraSaida(linha)
    },

    listBetween: async (companyId, from, to) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          SELECT * FROM appointments
          WHERE starts_at >= ${from}
            AND starts_at <= ${to}
            AND status = 'scheduled'
          ORDER BY starts_at
        `,
      )
      return linhas.map(paraSaida)
    },

    cancel: async (companyId, id, cancelledBy, cancelledAt, reason) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          UPDATE appointments
          SET status = 'cancelled',
              cancelled_at = ${cancelledAt},
              cancelled_by = ${cancelledBy},
              cancel_reason = ${reason ?? null},
              updated_at = now()
          WHERE id = ${id}
          RETURNING *
        `,
      )

      /*
       * A porta declara `Promise<AppointmentOutput>`, entao nao ha como
       * devolver "nao achei". O caso de uso ja consultou antes de chamar aqui
       * — mas entre as duas chamadas cabe outra requisicao cancelando o mesmo
       * compromisso, e ai o UPDATE nao acha linha nenhuma. Estourar com uma
       * mensagem que diz o que houve e melhor que devolver `undefined!` e
       * quebrar no acesso a propriedade, tres camadas acima.
       */
      if (linha === undefined) {
        throw new Error(`Compromisso ${id} nao encontrado para cancelar.`)
      }
      return paraSaida(linha)
    },
  }
}
