import type {
  RecebivelDaVenda,
  SaleCancellationTransaction,
  SaleCancellationUnitOfWork,
  SaleReturnUnitOfWork,
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
        SELECT product_id AS "productId", quantity - returned_quantity AS quantity
          FROM sale_items
         WHERE sale_id = ${saleId}
           /* O ja devolvido (RF-044) voltou ao estoque na devolucao: cancelar
              depois devolve so o que resta, e nao o vendido inteiro de novo. */
           AND quantity > returned_quantity
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
          FROM receivables
         WHERE sale_id = ${saleId}
           AND description = 'Fiado'
           AND status <> 'cancelled'
           /* O fiado AINDA devido, e nao o pago em carteira na venda: uma
              devolucao parcial (RF-044) ja tirou parte da carteira, e somar o
              pagamento original tiraria de novo. */
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

    restoreStock: (itens, origem) =>
      devolverEstoque(tx, companyId, itens, origem, 'sale_cancelled'),

    cancelReceivables: async (saleId) => {
      /*
       * `settled_at` vai a nulo junto com o status: a constraint
       * `receivables_liquidado_completo` so aceita data de liquidacao em
       * recebivel `settled`. Venda de balcao em dinheiro ou Pix nasce com o
       * recebivel JA liquidado, sem baixa em `settlements` — cancela-la e
       * devolver o dinheiro ao cliente. Sem limpar a data, o UPDATE violava a
       * constraint e o cancelamento de toda venda em dinheiro virava 500.
       * Baixa feita DEPOIS (em `settlements`) continua barrada no caso de uso.
       */
      await tx`
        UPDATE receivables
           SET status = 'cancelled', settled_at = NULL
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

/**
 * Devolve o estoque e grava o movimento — serve o cancelamento e a devolucao.
 * So o `kind` muda: `sale_cancelled` ou `sale_returned`, e e por ele que o
 * historico do produto diz o que aconteceu.
 */
async function devolverEstoque(
  tx: TransactionSql,
  companyId: string,
  itens: readonly { readonly productId: string; readonly quantity: number }[],
  origem: { readonly saleId: string; readonly createdBy: string; readonly createdAt: Date },
  kind: 'sale_cancelled' | 'sale_returned',
): Promise<void> {
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
            kind,
            quantity_delta: item.quantity,
            balance_after: produto.stock,
            reason: null,
            sale_id: origem.saleId,
            created_by: origem.createdBy,
            created_at: origem.createdAt,
          })}
        `
  }
}

/* -------------------------------------------------------------------------- */
/* Devolucao parcial — RF-044, NR-122                                         */
/* -------------------------------------------------------------------------- */

export function createSaleReturnUnitOfWork(sql: Sql): SaleReturnUnitOfWork {
  return {
    transaction: (companyId, fn) =>
      withTenant(sql, companyId, (tx) => {
        const base = escopo(tx, companyId)
        return fn({
          record: base.record,
          restoreStock: (itens, origem) =>
            devolverEstoque(tx, companyId, itens, origem, 'sale_returned'),
          decreaseWalletBalance: base.decreaseWalletBalance,

          findSale: async (saleId) => {
            const venda = await base.findSale(saleId)
            if (venda === undefined) return undefined

            const linhas = await tx<
              {
                saleItemId: string
                productId: string
                quantity: number
                returnedQuantity: number
                totalCents: string
              }[]
            >`
              SELECT id AS "saleItemId", product_id AS "productId", quantity,
                     returned_quantity AS "returnedQuantity", total_cents::text AS "totalCents"
                FROM sale_items
               WHERE sale_id = ${saleId}
               ORDER BY created_at, id
            `

            const recebiveis = await tx<
              {
                id: string
                description: string
                amountCents: string
                netAmountCents: string
                status: RecebivelDaVenda['status']
                dueDate: string
              }[]
            >`
              SELECT id, description, amount_cents::text AS "amountCents",
                     net_amount_cents::text AS "netAmountCents", status,
                     to_char(due_date, 'YYYY-MM-DD') AS "dueDate"
                FROM receivables
               WHERE sale_id = ${saleId}
            `

            return {
              id: venda.id,
              status: venda.status,
              customerId: venda.customerId,
              hasIssuedInvoice: venda.hasIssuedInvoice,
              settledCents: venda.settledCents,
              /* Linha sem produto (item avulso) nao e devolvivel por produto. */
              lines: linhas
                .filter((l) => l.productId !== null)
                .map((l) => ({
                  saleItemId: l.saleItemId,
                  productId: l.productId,
                  quantity: Number(l.quantity),
                  returnedQuantity: Number(l.returnedQuantity),
                  totalCents: Number(l.totalCents),
                })),
              receivables: recebiveis.map((r) => ({
                id: r.id,
                description: r.description,
                amountCents: Number(r.amountCents),
                netAmountCents: Number(r.netAmountCents),
                status: r.status,
                dueDate: r.dueDate,
              })),
            }
          },

          markLinesReturned: async (linhas) => {
            for (const l of linhas) {
              /* A constraint `sale_items_devolucao_ate_o_vendido` e a ultima
                 guarda: o caso de uso ja conferiu, o banco confere de novo. */
              await tx`
                UPDATE sale_items
                   SET returned_quantity = returned_quantity + ${l.quantity}
                 WHERE id = ${l.saleItemId}
              `
            }
          },

          reduceReceivable: async (id, novo) => {
            /* Liquidado continua liquidado: o que entrou ja foi para o caixa, e
               o valor novo e o que ficou. `settled_amount_cents` acompanha. */
            await tx`
              UPDATE receivables
                 SET amount_cents = ${novo.amountCents},
                     net_amount_cents = ${novo.netAmountCents},
                     settled_amount_cents = CASE WHEN status = 'settled'
                                                 THEN ${novo.amountCents}
                                                 ELSE settled_amount_cents END,
                     updated_at = now()
               WHERE id = ${id}
            `
          },

          cancelReceivable: async (id) => {
            /* `settled_at = NULL` junto: a constraint `receivables_liquidado_completo`
               exige, e foi ela que derrubava o cancelamento em dinheiro (#293). */
            await tx`
              UPDATE receivables
                 SET status = 'cancelled', settled_at = NULL, updated_at = now()
               WHERE id = ${id}
            `
          },

          addReturnedAmount: async (saleId, valor, inteira) => {
            await tx`
              UPDATE sales
                 SET returned_amount_cents = returned_amount_cents + ${valor},
                     status = CASE WHEN ${inteira} THEN 'returned' ELSE status END
               WHERE id = ${saleId}
            `
          },
        })
      }),
  }
}
