import type {
  SaleCancellationTransaction,
  SaleCancellationUnitOfWork,
  SaleToCancel,
} from '@na-regua/core'
import { gravarTrilha } from './audit-repository.js'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Cancelamento de venda no Postgres — RF-043, NR-121.
 *
 * Nenhuma migration nova: `sales` ja nasceu com `cancelled_at`, `cancelled_by`
 * e `cancel_reason`, e com a constraint `sales_cancelamento_completo`, que
 * exige os tres juntos do status. O que faltava era o caso de uso.
 *
 * Tudo numa transacao so, com o tenant definido (`withTenant`): estoque,
 * recebivel, carteira e status voltam juntos ou nao voltam (RNF-046).
 */
export function createSaleCancellationUnitOfWork(sql: Sql): SaleCancellationUnitOfWork {
  return {
    transaction: (companyId, fn) => withTenant(sql, companyId, (tx) => fn(escopo(tx, companyId))),
  }
}

function escopo(tx: TransactionSql, companyId: string): SaleCancellationTransaction {
  return {
    record: (entrada) => gravarTrilha(tx, entrada),

    findSale: async (saleId) => {
      const [venda] = await tx<{ id: string; status: string; customerId: string | null }[]>`
        SELECT id, status, customer_id AS "customerId"
          FROM sales
         WHERE id = ${saleId}
      `
      if (venda === undefined) return undefined

      const itens = await tx<{ productId: string; quantity: number }[]>`
        SELECT product_id AS "productId", quantity
          FROM sale_items
         WHERE sale_id = ${saleId}
      `

      /*
       * `cancelled` nao conta: nota ja cancelada nao trava mais nada. As outras
       * tres travam, inclusive `rejected` e `contingency` — enquanto o estado
       * na SEFAZ nao estiver resolvido, estornar aqui cria divergencia.
       */
      const [nota] = await tx<{ existe: boolean }[]>`
        SELECT true AS existe
          FROM invoices
         WHERE sale_id = ${saleId}
           AND status <> 'cancelled'
         LIMIT 1
      `

      /* Baixa de recebivel desta venda. Soma, e nao existencia: o caso de uso
         quer saber QUANTO ja entrou no caixa. */
      const [baixado] = await tx<{ total: string | null }[]>`
        SELECT COALESCE(SUM(s.amount_cents), 0)::text AS total
          FROM settlements s
          JOIN receivables r ON r.id = s.receivable_id
         WHERE r.sale_id = ${saleId}
      `

      const [carteira] = await tx<{ total: string | null }[]>`
        SELECT COALESCE(SUM(amount_cents), 0)::text AS total
          FROM payments
         WHERE sale_id = ${saleId}
           AND method = 'wallet'
      `

      return {
        id: venda.id,
        status: venda.status as SaleToCancel['status'],
        customerId: venda.customerId,
        items: itens.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })),
        hasIssuedInvoice: nota !== undefined,
        settledCents: Number(baixado?.total ?? 0),
        walletCents: Number(carteira?.total ?? 0),
      }
    },

    restoreStock: async (itens, origem) => {
      for (const item of itens) {
        const [produto] = await tx<{ stock: number }[]>`
          UPDATE products
             SET stock = stock + ${item.quantity},
                 updated_at = ${origem.createdAt}
           WHERE id = ${item.productId}
          RETURNING stock
        `

        /* Mesmo raciocinio da baixa da venda: dentro da transacao o produto nao
           deveria sumir. Falhar alto e melhor que movimento sem saldo. */
        if (!produto) {
          throw new Error(
            `Produto ${item.productId} desapareceu no meio do cancelamento da venda ${origem.saleId}.`,
          )
        }

        await tx`
          INSERT INTO inventory_movements ${tx({
            company_id: companyId,
            product_id: item.productId,
            kind: 'sale_cancelled',
            quantity_delta: item.quantity,
            balance_after: produto.stock,
            reason: null,
            sale_id: origem.saleId,
            created_by: origem.createdBy,
            created_at: origem.createdAt,
          })}
        `
      }
    },

    cancelReceivables: async (saleId) => {
      await tx`
        UPDATE receivables
           SET status = 'cancelled'
         WHERE sale_id = ${saleId}
           AND status <> 'cancelled'
      `
    },

    decreaseWalletBalance: async (customerId, amountCents) => {
      await tx`
        UPDATE customers
           SET wallet_balance_cents = wallet_balance_cents - ${amountCents}
         WHERE id = ${customerId}
      `
    },

    markCancelled: async (saleId, dados) => {
      /* Os tres campos juntos do status: e o que a constraint
         `sales_cancelamento_completo` exige, e o motivo de nao dar para marcar
         cancelada e preencher o resto depois. */
      await tx`
        UPDATE sales
           SET status = 'cancelled',
               cancelled_at = ${dados.at},
               cancelled_by = ${dados.by},
               cancel_reason = ${dados.reason}
         WHERE id = ${saleId}
      `
    },
  }
}
