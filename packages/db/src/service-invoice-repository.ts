import type { ServiceInvoiceResult } from '@na-regua/contracts'
import type {
  EmpresaParaNfse,
  NfseGuardada,
  ServiceInvoiceRepository,
  VendaParaNfse,
} from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * A NFS-e da venda — DEC-031, NR-241. Implementa `ServiceInvoiceRepository`.
 *
 * Uma linha por venda (`service_invoices_uma_por_venda`). A rejeitada volta a
 * `processing` quando o lojista corrige e pede de novo; a que ja foi
 * autorizada nunca e sobrescrita por uma resposta atrasada.
 */

type Linha = {
  status: NfseGuardada['status']
  amount_cents: string | number
  discount_cents: string | number
  description: string
  number: string | null
  access_key: string | null
  verification_code: string | null
  danfse_url: string | null
  public_url: string | null
  rejection_code: string | null
  rejection_message: string | null
  requested_at: Date
  issued_at: Date | null
  cancelled_at: Date | null
  last_checked_at: Date | null
  checks: number
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString())

function paraGuardada(l: Linha): NfseGuardada {
  return {
    status: l.status,
    amountCents: Number(l.amount_cents),
    discountCents: Number(l.discount_cents),
    description: l.description,
    number: l.number,
    accessKey: l.access_key,
    verificationCode: l.verification_code,
    danfseUrl: l.danfse_url,
    publicUrl: l.public_url,
    rejection:
      l.status === 'rejected'
        ? { code: l.rejection_code ?? 'DESCONHECIDO', message: l.rejection_message ?? '' }
        : null,
    requestedAt: l.requested_at.toISOString(),
    issuedAt: iso(l.issued_at),
    cancelledAt: iso(l.cancelled_at),
    lastCheckedAt: iso(l.last_checked_at),
    checks: l.checks,
  }
}

export function createServiceInvoiceRepository(sql: Sql): ServiceInvoiceRepository {
  return {
    saleForNfse: async (companyId, saleId): Promise<VendaParaNfse | undefined> =>
      withTenant(sql, companyId, async (tx) => {
        const [venda] = await tx<
          {
            id: string
            created_at: Date
            gross_amount_cents: string | number
            discount_cents: string | number
            customer_id: string | null
          }[]
        >`
          SELECT id, created_at, gross_amount_cents, discount_cents, customer_id
          FROM sales WHERE id = ${saleId} AND status <> 'cancelled'
        `
        /* Venda cancelada nao vira nota: o servico foi desfeito. */
        if (venda === undefined) return undefined

        const [itens, clientes] = await Promise.all([
          tx<
            {
              description: string
              quantity: number
              unit_price_cents: string | number
              nbs_code: string | null
            }[]
          >`
            SELECT i.description, i.quantity, i.unit_price_cents, p.nbs_code
            FROM sale_items i
            LEFT JOIN products p ON p.id = i.product_id
            WHERE i.sale_id = ${saleId}
            ORDER BY i.id
          `,
          venda.customer_id === null
            ? Promise.resolve([])
            : tx<{ name: string; document: string | null; email: string | null }[]>`
                SELECT name, document, email FROM customers WHERE id = ${venda.customer_id}
              `,
        ])

        const cliente = clientes[0]
        return {
          saleId: venda.id,
          soldAt: venda.created_at,
          grossAmountCents: Number(venda.gross_amount_cents),
          discountCents: Number(venda.discount_cents),
          items: itens.map((i) => ({
            description: i.description,
            quantity: i.quantity,
            unitPriceCents: Number(i.unit_price_cents),
            nbsCode: i.nbs_code,
          })),
          customer:
            cliente === undefined
              ? undefined
              : {
                  name: cliente.name,
                  ...(cliente.document === null ? {} : { document: cliente.document }),
                  ...(cliente.email === null ? {} : { email: cliente.email }),
                },
        }
      }),

    companyForNfse: async (companyId): Promise<EmpresaParaNfse | undefined> => {
      const [l] = await withTenant(
        sql,
        companyId,
        (tx) => tx<
          {
            cnpj: string
            municipal_registration: string | null
            city: string | null
            state: string | null
            city_ibge_code: string | null
            tax_regime: string
            national_service_code: string | null
            iss_rate_percent: string | number | null
          }[]
        >`
          SELECT cnpj, municipal_registration, city, state, city_ibge_code, tax_regime,
                 national_service_code, iss_rate_percent
          FROM companies WHERE id = ${companyId}
        `,
      )
      if (l === undefined) return undefined
      return {
        cnpj: l.cnpj,
        municipalRegistration: l.municipal_registration,
        city: l.city,
        state: l.state,
        cityIbgeCode: l.city_ibge_code,
        taxRegime: l.tax_regime,
        nationalServiceCode: l.national_service_code,
        issRatePercent: l.iss_rate_percent === null ? null : Number(l.iss_rate_percent),
      }
    },

    saveCityCode: async (companyId, codigo) => {
      await withTenant(
        sql,
        companyId,
        (tx) => tx`UPDATE companies SET city_ibge_code = ${codigo} WHERE id = ${companyId}`,
      )
    },

    find: async (companyId, saleId) => {
      const [l] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`SELECT * FROM service_invoices WHERE sale_id = ${saleId}`,
      )
      return l === undefined ? undefined : paraGuardada(l)
    },

    /**
     * Cria a linha, ou devolve a REJEITADA a `processing`. Qualquer outro
     * estado fica como esta e a resposta e `false`: o segundo clique perde.
     */
    open: async (companyId, saleId, p) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<{ id: string }[]>`
          INSERT INTO service_invoices (
            company_id, sale_id, status, amount_cents, discount_cents, description, requested_at
          )
          VALUES (
            ${companyId}, ${saleId}, 'processing', ${p.amountCents}, ${p.discountCents},
            ${p.description}, ${p.requestedAt}
          )
          ON CONFLICT (company_id, sale_id) DO UPDATE SET
            status = 'processing',
            amount_cents = EXCLUDED.amount_cents,
            discount_cents = EXCLUDED.discount_cents,
            description = EXCLUDED.description,
            requested_at = EXCLUDED.requested_at,
            rejection_code = NULL,
            rejection_message = NULL,
            last_checked_at = NULL,
            checks = 0,
            updated_at = now()
          WHERE service_invoices.status = 'rejected'
          RETURNING id
        `,
      )
      return linhas.length > 0
    },

    /**
     * Grava a resposta do provedor. So mexe em nota que ainda esta
     * `processing`: uma consulta atrasada nao desfaz uma autorizacao nem uma
     * cancelada.
     */
    record: async (companyId, saleId, r: ServiceInvoiceResult, em) => {
      await withTenant(sql, companyId, (tx) => {
        switch (r.status) {
          case 'processing':
            return tx`
              UPDATE service_invoices
              SET last_checked_at = ${em}, checks = checks + 1, updated_at = now()
              WHERE sale_id = ${saleId} AND status = 'processing'
            `
          case 'authorized':
            return tx`
              UPDATE service_invoices SET
                status = 'authorized', number = ${r.number},
                access_key = ${r.accessKey ?? null},
                verification_code = ${r.verificationCode ?? null},
                danfse_url = ${r.danfseUrl}, public_url = ${r.publicUrl ?? null},
                xml_path = ${r.xmlPath}, issued_at = ${r.issuedAt},
                last_checked_at = ${em}, checks = checks + 1, updated_at = now()
              WHERE sale_id = ${saleId} AND status = 'processing'
            `
          case 'rejected':
            return tx`
              UPDATE service_invoices SET
                status = 'rejected', rejection_code = ${r.rejection.code},
                rejection_message = ${r.rejection.message},
                last_checked_at = ${em}, checks = checks + 1, updated_at = now()
              WHERE sale_id = ${saleId} AND status = 'processing'
            `
          case 'cancelled':
            return tx`
              UPDATE service_invoices SET
                status = 'cancelled', number = COALESCE(${r.number ?? null}, number),
                access_key = COALESCE(${r.accessKey ?? null}, access_key),
                cancelled_at = COALESCE(cancelled_at, ${em}),
                last_checked_at = ${em}, checks = checks + 1, updated_at = now()
              WHERE sale_id = ${saleId} AND status = 'processing'
            `
        }
      })
    },

    markCancelled: async (companyId, saleId, motivo, em) => {
      await withTenant(
        sql,
        companyId,
        (tx) => tx`
          UPDATE service_invoices SET
            status = 'cancelled', cancellation_reason = ${motivo}, cancelled_at = ${em},
            updated_at = now()
          WHERE sale_id = ${saleId} AND status = 'authorized'
        `,
      )
    },
  }
}
