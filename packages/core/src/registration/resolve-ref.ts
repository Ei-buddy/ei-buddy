import { AppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import { searchCustomers, type SearchCustomersDeps } from './register-customer.js'
import { searchProducts, type SearchProductsDeps } from './register-product.js'

const LIMITE = 5

/**
 * Id ou nome de produto. findById primeiro; senão busca textual.
 * Um hit grava; zero ou N viram AppError — o agente nao escolhe no chute.
 */
export async function resolveProductRef(
  deps: SearchProductsDeps,
  ctx: ExecutionContext,
  ref: string,
): Promise<string> {
  const porId = await tentarPorId(() => deps.products.findById(ctx.companyId, ref))
  if (porId !== undefined) return porId

  const candidatos = await searchProducts(deps, ctx, { termo: ref, limite: LIMITE })
  if (candidatos.length === 0) throw AppError.notFound('Produto nao encontrado.')
  if (candidatos.length === 1) return candidatos[0]!.id

  const opcoes = candidatos.map((p) => `- ${p.description} (${p.id})`).join('\n')
  throw AppError.validation(`Encontrei mais de um produto. Qual deles?\n${opcoes}`)
}

/** Id ou nome de cliente. Mesma regra do produto. */
export async function resolveCustomerRef(
  deps: SearchCustomersDeps,
  ctx: ExecutionContext,
  ref: string,
): Promise<string> {
  const porId = await tentarPorId(() => deps.customers.findById(ctx.companyId, ref))
  if (porId !== undefined) return porId

  const candidatos = await searchCustomers(deps, ctx, { termo: ref, limite: LIMITE })
  if (candidatos.length === 0) throw AppError.notFound('Cliente nao encontrado.')
  if (candidatos.length === 1) return candidatos[0]!.id

  const opcoes = candidatos.map((c) => `- ${c.name} (${c.id})`).join('\n')
  throw AppError.validation(`Encontrei mais de um cliente. Qual deles?\n${opcoes}`)
}

/**
 * Postgres rejeita nome em coluna uuid (`invalid input syntax`).
 * O agente manda nome; cai na busca textual em vez de estourar genérico.
 */
async function tentarPorId(
  buscar: () => Promise<{ id: string } | undefined>,
): Promise<string | undefined> {
  try {
    return (await buscar())?.id
  } catch {
    return undefined
  }
}
