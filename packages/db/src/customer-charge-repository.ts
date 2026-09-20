import type { CobrancaRegistrada, CustomerChargeRepository } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Cobranca a distancia — NR-044, RF-068.
 *
 * Duas tabelas numa transacao so: a cobranca e os titulos que ela cobre. Meia
 * gravacao seria o pior estado possivel — uma cobranca sem titulos e um link
 * vivo que nao leva a lugar nenhum, e e exatamente o defeito que estas tabelas
 * existem para consertar.
 */
export function createCustomerChargeRepository(sql: Sql): CustomerChargeRepository {
  return {
    registrar: async (entrada) => {
      await withTenant(sql, entrada.companyId, async (tx) => {
        const [cobranca] = await tx<{ id: string }[]>`
          INSERT INTO customer_charges (
            company_id, customer_id, external_reference, amount_cents,
            provider_link_id, checkout_url, status, created_at, updated_at
          )
          VALUES (
            ${entrada.companyId}, ${entrada.customerId}, ${entrada.externalReference},
            ${entrada.amountCents}, ${entrada.providerLinkId}, ${entrada.checkoutUrl},
            'pending', ${entrada.createdAt}, ${entrada.createdAt}
          )
          /*
           * Idempotencia no BANCO, pelo indice unico de referencia.
           *
           * O reenvio do mesmo pedido reaproveita o link no provedor; se aqui
           * nascesse uma segunda cobranca, a baixa aconteceria duas vezes para
           * um pagamento so. O \`DO UPDATE\` de um campo para si mesmo existe
           * porque \`DO NOTHING\` nao devolve linha no RETURNING — e sem a linha
           * nao da para ligar os titulos.
           */
          ON CONFLICT (company_id, external_reference) WHERE deleted_at IS NULL
            DO UPDATE SET updated_at = customer_charges.updated_at
          RETURNING id
        `

        if (cobranca === undefined) {
          throw new Error('Nao foi possivel registrar a cobranca ao cliente.')
        }

        for (const titulo of entrada.titulos) {
          await tx`
            INSERT INTO customer_charge_receivables
              (company_id, charge_id, receivable_id, amount_cents)
            VALUES (
              ${entrada.companyId}, ${cobranca.id}, ${titulo.receivableId}, ${titulo.amountCents}
            )
            /* Segundo envio do mesmo pedido: a ligacao ja existe, e o valor
               cobrado continua sendo o da PRIMEIRA vez — e o que o cliente viu
               no link. */
            ON CONFLICT (company_id, charge_id, receivable_id) DO NOTHING
          `
        }
      })
    },

    porReferencia: async (companyId, externalReference) => {
      return withTenant(sql, companyId, async (tx) => {
        const [cobranca] = await tx<
          { id: string; customer_id: string | null; amount_cents: string; status: string }[]
        >`
          SELECT id, customer_id, amount_cents, status
            FROM customer_charges
           WHERE external_reference = ${externalReference}
             AND deleted_at IS NULL
        `

        if (cobranca === undefined) return undefined

        const titulos = await tx<{ receivable_id: string; amount_cents: string }[]>`
          SELECT receivable_id, amount_cents
            FROM customer_charge_receivables
           WHERE charge_id = ${cobranca.id}
           ORDER BY created_at
        `

        return {
          id: cobranca.id,
          customerId: cobranca.customer_id,
          /* `bigint` volta STRING no driver. Sem isto, a baixa mandaria texto
             para onde se espera centavo. */
          amountCents: Number(cobranca.amount_cents),
          status: cobranca.status as CobrancaRegistrada['status'],
          titulos: titulos.map((t) => ({
            receivableId: t.receivable_id,
            amountCents: Number(t.amount_cents),
          })),
        }
      })
    },

    marcarPaga: async (entrada) => {
      await withTenant(
        sql,
        entrada.companyId,
        (tx) => tx`
          UPDATE customer_charges
             SET status = 'paid',
                 paid_at = ${entrada.paidAt},
                 provider_event_id = ${entrada.providerEventId},
                 updated_at = ${entrada.paidAt}
           WHERE id = ${entrada.chargeId}
             /* So sai de pendente. Um UPDATE sem esta condicao deixaria um
                segundo aviso reescrever a data de pagamento de uma cobranca
                ja baixada — e o lojista veria a baixa mudar de dia sozinha. */
             AND status = 'pending'
        `,
      )
    },
  }
}
