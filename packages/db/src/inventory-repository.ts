import { gravarTrilha } from './audit-repository.js'
import type {
  InventoryProductSnapshot,
  InventoryQueries,
  InventoryTransaction,
  InventoryUnitOfWork,
  NewInventoryMovement,
} from '@na-regua/core'
import type { InventoryMovementOutput } from '@na-regua/contracts'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * O estoque no banco — NR-023, RF-022 a RF-024, RF-124.
 *
 * `core` tinha o caso de uso e o teste contra falso desde a NR-023; faltava
 * quem gravasse. Sem esta implementacao, `adjustStock` nao tinha onde escrever
 * e nenhuma rota podia expo-lo — o ajuste de inventario existia no papel e nao
 * no produto.
 *
 * ## `tracks_stock` e `location` — migration 0022, NR-115
 *
 * `tracks_stock = false` faz `stockQuantity` voltar `null` (sem controle), nao
 * zero. `location` e opcional: ausente continua `null`, nunca um chute.
 */

const numero = (valor: unknown): number => Number(valor)

type LinhaProduto = {
  id: string
  description: string
  sale_price_cents: string | number
  stock: number
  min_stock: number
  tracks_stock: boolean
  location: string | null
}

const paraSnapshot = (l: LinhaProduto): InventoryProductSnapshot => ({
  id: l.id,
  description: l.description,
  salePriceCents: numero(l.sale_price_cents),
  stockQuantity: l.tracks_stock ? l.stock : null,
  location: l.location,
  minStock: l.min_stock,
})

type LinhaMovimento = {
  id: string
  product_id: string
  kind: string
  quantity_delta: number
  balance_after: number
  reason: string | null
  sale_id: string | null
  created_at: Date
  created_by: string
}

const paraMovimento = (l: LinhaMovimento): InventoryMovementOutput => ({
  id: l.id,
  productId: l.product_id,
  kind: l.kind as InventoryMovementOutput['kind'],
  quantityDelta: l.quantity_delta,
  balanceAfter: l.balance_after,
  reason: l.reason,
  saleId: l.sale_id,
  createdAt: l.created_at.toISOString(),
  createdBy: l.created_by,
})

/**
 * A leitura, dentro ou fora de transacao.
 *
 * `deleted_at IS NULL` porque produto apagado nao tem saldo a ajustar — e o
 * caso de uso responde "produto nao encontrado", que e o que o lojista precisa
 * ouvir em vez de um erro de banco.
 */
function leitor(tx: Sql | TransactionSql) {
  return {
    findById: async (
      _companyId: string,
      productId: string,
    ): Promise<InventoryProductSnapshot | undefined> => {
      const [linha] = await tx<LinhaProduto[]>`
        SELECT id, description, sale_price_cents, stock, min_stock, tracks_stock, location
        FROM products
        WHERE id = ${productId} AND deleted_at IS NULL
      `
      return linha === undefined ? undefined : paraSnapshot(linha)
    },
  }
}

function escopo(tx: TransactionSql, companyId: string): InventoryTransaction {
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
    products: leitor(tx),

    /**
     * Grava o saldo ABSOLUTO que passa a valer.
     *
     * Absoluto e nao incremento: o lojista contou dezoito, entao sao dezoito.
     * Um `stock = stock + delta` reintroduziria a corrida que
     * ler dentro da transacao evitou — o delta teria sido calculado sobre um
     * saldo que outra venda ja mudou.
     */
    setStock: async (productId, quantity) => {
      const linhas = await tx`
        UPDATE products
           SET stock = ${quantity}, updated_at = now()
         WHERE id = ${productId} AND deleted_at IS NULL
        RETURNING id
      `

      if (linhas.length === 0) {
        /* O caso de uso ja conferiu que existe, e estamos na mesma transacao.
           Chegar aqui e o produto ter sumido no meio — falhar alto e melhor
           que gravar o movimento sem o saldo correspondente. */
        throw new Error(`Produto ${productId} desapareceu no meio do ajuste de estoque.`)
      }
    },

    insertMovement: async (m: NewInventoryMovement) => {
      const [linha] = await tx<LinhaMovimento[]>`
        INSERT INTO inventory_movements ${tx({
          company_id: companyId,
          product_id: m.productId,
          kind: m.kind,
          quantity_delta: m.quantityDelta,
          balance_after: m.balanceAfter,
          reason: m.reason,
          sale_id: m.saleId,
          created_by: m.createdBy,
          created_at: m.createdAt,
        })}
        RETURNING *
      `

      if (linha === undefined) {
        throw new Error('O movimento de estoque nao foi gravado.')
      }

      return paraMovimento(linha)
    },
  }
}

export function createInventoryUnitOfWork(sql: Sql): InventoryUnitOfWork {
  return {
    transaction: (companyId, fn) => withTenant(sql, companyId, (tx) => fn(escopo(tx, companyId))),
  }
}

/**
 * Leitura de saldo fora de transacao — RF-022.
 *
 * Consultar saldo no balcao e leitura pura e frequente; abrir transacao para
 * ela seria custo sem contrapartida. O `withTenant` continua, porque sem ele a
 * politica de RLS nao sabe de qual loja se trata e a consulta falha (RF-121).
 */
export function createInventoryQueries(sql: Sql): InventoryQueries {
  return {
    products: {
      findById: (companyId, productId) =>
        withTenant(sql, companyId, (tx) => leitor(tx).findById(companyId, productId)),
    },
  }
}

/**
 * O historico de um produto — a tela de "por que o saldo esta assim?".
 *
 * Fora da porta de `core` de proposito: e leitura de apresentacao, e nenhum
 * caso de uso depende dela.
 *
 * `ORDER BY seq`, e nao `created_at`: o carimbo vem do instante da REQUISICAO,
 * entao movimentos da mesma chamada — importacao de planilha, ajuste em lote —
 * nascem todos iguais e o desempate cairia num uuid aleatorio. A trilha voltaria
 * mostrando saldo 8 depois de saldo 25, e deixaria de explicar o que existe para
 * explicar. A migration 0016 deu a ela uma ordem total; o indice
 * `inventory_movements_por_produto_seq` serve exatamente esta consulta.
 */
export function createInventoryHistory(sql: Sql) {
  return {
    byProduct: async (
      companyId: string,
      productId: string,
      limite: number,
    ): Promise<readonly InventoryMovementOutput[]> => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaMovimento[]>`
          SELECT * FROM inventory_movements
          WHERE product_id = ${productId}
          ORDER BY seq DESC
          LIMIT ${limite}
        `,
      )
      return linhas.map(paraMovimento)
    },
  }
}
