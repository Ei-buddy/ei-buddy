import type { PaymentMethod } from '@na-regua/contracts'
import type { ItemFiscalDaVenda, SaleFiscalReader, VendaParaNota } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Os dados da venda que viram nota — NR-042, RF-045, RF-046.
 *
 * A classificacao vem do PRODUTO e nao do item vendido: o item guarda descricao
 * e preco praticados, que podem ter mudado, e a nota descreve o que foi vendido
 * com a classificacao que o cadastro tem hoje. `LEFT JOIN` porque venda avulsa
 * nao tem produto — e ela cai na recusa da pre-checagem, com nome e tudo.
 */

const numero = (v: unknown): number => Number(v)

type LinhaItem = {
  product_id: string | null
  description: string
  quantity: number
  unit_price_cents: string | number
  unit_of_measure: string
  ncm: string | null
  cfop: string | null
  tax_situation_code: string | null
  nbs_code: string | null
}

export function createSaleFiscalReader(sql: Sql): SaleFiscalReader {
  return {
    forInvoice: async (companyId, saleId): Promise<VendaParaNota | undefined> => {
      return withTenant(sql, companyId, async (tx) => {
        const [venda] = await tx<{ id: string; customer_id: string | null }[]>`
          SELECT id, customer_id FROM sales
          WHERE id = ${saleId} AND status <> 'cancelled'
        `

        /* Venda cancelada nao vira nota: o cliente devolveu, e emitir agora
           criaria um documento fiscal de algo que nao aconteceu. */
        if (venda === undefined) return undefined

        const [itens, pagamentos, cliente] = await Promise.all([
          tx<LinhaItem[]>`
            SELECT i.product_id, i.description, i.quantity, i.unit_price_cents,
                   i.unit_of_measure,
                   p.ncm, p.cfop, p.tax_situation_code, p.nbs_code
            FROM sale_items i
            LEFT JOIN products p ON p.id = i.product_id
            WHERE i.sale_id = ${saleId}
            ORDER BY i.id
          `,
          tx<{ method: string; amount_cents: string | number }[]>`
            SELECT method, amount_cents FROM payments WHERE sale_id = ${saleId} ORDER BY id
          `,
          venda.customer_id === null
            ? Promise.resolve([])
            : tx<{ name: string; document: string | null }[]>`
                SELECT name, document FROM customers WHERE id = ${venda.customer_id}
              `,
        ])

        const destinatario = cliente[0]

        return {
          saleId: venda.id,
          items: itens.map((i): ItemFiscalDaVenda => ({
            productId: i.product_id,
            description: i.description,
            quantity: i.quantity,
            unitPriceCents: numero(i.unit_price_cents),
            unitOfMeasure: i.unit_of_measure as ItemFiscalDaVenda['unitOfMeasure'],
            ncm: i.ncm,
            cfop: i.cfop,
            taxSituationCode: i.tax_situation_code,
            nbsCode: i.nbs_code,
          })),
          payments: pagamentos.map((p) => ({
            method: p.method as PaymentMethod,
            amountCents: numero(p.amount_cents),
          })),
          /*
           * Cliente so entra na nota quando tem DOCUMENTO: a NFC-e identifica o
           * destinatario por CPF ou CNPJ, e mandar so o nome nao identifica
           * ninguem — a SEFAZ recusaria, ou pior, aceitaria uma nota que nao
           * serve ao cliente na hora de pedir nota fiscal.
           */
          recipient:
            destinatario === undefined || destinatario.document === null
              ? undefined
              : { name: destinatario.name, document: destinatario.document },
        }
      })
    },
  }
}
