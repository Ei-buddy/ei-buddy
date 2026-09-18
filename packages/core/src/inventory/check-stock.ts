import type {
  CheckStockByQueryInput,
  CheckStockInput,
  ProductOutput,
  StockViewOutput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type { InventoryQueries } from '../ports/inventory-writers.js'
import { searchProducts, type SearchProductsDeps } from '../registration/register-product.js'

export type CheckStockDeps = InventoryQueries

/** Resultado da busca textual antes da consulta final — NR-115. */
export type CheckStockByQueryResult =
  | { readonly status: 'found'; readonly view: StockViewOutput }
  | { readonly status: 'not_found' }
  | { readonly status: 'ambiguous'; readonly alternatives: readonly ProductOutput[] }

export type CheckStockByQueryDeps = SearchProductsDeps & {
  readonly inventory: InventoryQueries
}

const LIMITE_BUSCA_ESTOQUE = 5

/**
 * Saldo, preco e localizacao de um produto — RF-022.
 *
 * Leitura: nao passa por `assertCanWrite`. `accountant` e somente leitura,
 * entao consulta estoque como qualquer um.
 *
 * Produto de outra empresa responde NOT_FOUND, nunca FORBIDDEN: um 403
 * confirmaria que o id existe em algum lugar, e a existencia ja e informacao.
 */
export async function checkStock(
  deps: CheckStockDeps,
  ctx: ExecutionContext,
  input: CheckStockInput,
): Promise<StockViewOutput> {
  const produto = await deps.products.findById(ctx.companyId, input.productId)

  if (produto === undefined) {
    throw AppError.notFound('Produto nao encontrado.')
  }

  return {
    productId: produto.id,
    description: produto.description,
    salePriceCents: produto.salePriceCents,
    stockQuantity: produto.stockQuantity,
    location: produto.location,
    minStock: produto.minStock,
    belowMinimum: estaAbaixoDoMinimo(produto.stockQuantity, produto.minStock),
  }
}

/**
 * Abaixo do minimo — RF-025.
 *
 * Exportada porque a lista de reposicao (RF-025) vai precisar da MESMA
 * definicao, e duas definicoes de "abaixo do minimo" e a garantia de que a
 * lista e a ficha do produto vao discordar em algum caso de borda.
 *
 * Produto sem controle de estoque nunca esta abaixo do minimo: nao ha saldo
 * para comparar. Responder `true` faria o granel aparecer na lista de compras
 * todo dia, e uma lista que sempre acusa deixa de ser lida.
 */
export function estaAbaixoDoMinimo(saldo: number | null, minimo: number | null): boolean {
  if (saldo === null || minimo === null) return false
  return saldo < minimo
}

/**
 * Consulta de estoque por texto — NR-115, RF-133.
 *
 * Busca primeiro; so chama `checkStock` quando ha candidato unico. Zero ou varios
 * candidatos terminam em ausencia ou desambiguacao, sem escolher produto.
 */
export async function checkStockByQuery(
  deps: CheckStockByQueryDeps,
  ctx: ExecutionContext,
  input: CheckStockByQueryInput,
): Promise<CheckStockByQueryResult> {
  const candidatos = await searchProducts(deps, ctx, {
    termo: input.query,
    limite: LIMITE_BUSCA_ESTOQUE,
  })

  if (candidatos.length === 0) {
    return { status: 'not_found' }
  }

  if (candidatos.length > 1) {
    return { status: 'ambiguous', alternatives: candidatos }
  }

  const view = await checkStock(deps.inventory, ctx, { productId: candidatos[0]!.id })
  return { status: 'found', view }
}
