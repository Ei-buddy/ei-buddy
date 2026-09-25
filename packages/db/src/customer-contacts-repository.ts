import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Contatos do cliente — RF-011, NR-072.
 *
 * Satisfaz `CustomerContactRepository` de `core` estruturalmente: `db` nao
 * importa `core` (principio 1), entao os tipos aqui sao escritos em vocabulario
 * de `contracts` e a composicao amarra os dois.
 */

type LinhaContato = {
  id: string
  kind: 'call' | 'whatsapp' | 'visit' | 'note'
  description: string
  happened_on: string
  created_at: Date
}

type ContatoDeSaida = {
  readonly id: string
  readonly kind: 'call' | 'whatsapp' | 'visit' | 'note'
  readonly description: string
  readonly happenedOn: string
  readonly createdAt: string
}

type ContatoNovo = {
  readonly companyId: string
  readonly customerId: string
  readonly kind: 'call' | 'whatsapp' | 'visit' | 'note'
  readonly description: string
  readonly happenedOn: string
  readonly createdBy: string
}

/**
 * `happened_on` volta como texto do proprio Postgres.
 *
 * `date` sem fuso vira `Date` a meia-noite UTC no driver, e formatar isso de
 * volta em outro fuso devolveria o dia anterior — o contato lancado dia 5
 * apareceria como dia 4 para metade do pais. O `::text` resolve na origem.
 */
const paraContato = (l: LinhaContato): ContatoDeSaida => ({
  id: l.id,
  kind: l.kind,
  description: l.description,
  happenedOn: l.happened_on,
  createdAt: l.created_at.toISOString(),
})

export function createCustomerContactRepository(sql: Sql) {
  return {
    create: async (c: ContatoNovo): Promise<ContatoDeSaida | undefined> => {
      return withTenant(sql, c.companyId, async (tx) => {
        /*
         * Confere o cliente ANTES de inserir, e a RLS nao faria isso sozinha:
         * a linha nova levaria o `company_id` do contexto ainda que o
         * `customer_id` fosse de outra loja, e o banco aceitaria — a chave
         * estrangeira nao sabe de tenant.
         *
         * O `deleted_at` fica de fora da conferencia de proposito: dá para
         * anotar o contato que fechou o assunto com um cliente que ja saiu da
         * lista, e recusar ali seria proibir justamente o registro do motivo.
         */
        const [cliente] = await tx<{ id: string }[]>`
          SELECT id FROM customers WHERE id = ${c.customerId}
        `
        if (cliente === undefined) return undefined

        const [linha] = await tx<LinhaContato[]>`
          INSERT INTO customer_contacts
            (company_id, customer_id, kind, description, happened_on, created_by)
          VALUES (${c.companyId}, ${c.customerId}, ${c.kind}, ${c.description},
                  ${c.happenedOn}, ${c.createdBy})
          RETURNING id, kind, description, happened_on::text, created_at
        `

        return paraContato(linha!)
      })
    },

    listByCustomer: async (
      companyId: string,
      customerId: string,
      limite: number,
    ): Promise<readonly ContatoDeSaida[]> => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaContato[]>`
          SELECT id, kind, description, happened_on::text, created_at
            FROM customer_contacts
           WHERE customer_id = ${customerId}
           /* Do fato mais recente para o mais antigo, que e a ordem do indice.
              "created_at" desempata o dia com mais de um lancamento. */
           ORDER BY happened_on DESC, created_at DESC
           LIMIT ${limite}
        `,
      )

      return linhas.map(paraContato)
    },
  }
}
