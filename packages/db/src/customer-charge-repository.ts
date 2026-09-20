import type { CustomerChargeRepository } from '@na-regua/core'
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
            ON CONFLICT (charge_id, receivable_id) DO NOTHING
          `
        }
      })
    },
  }
}
