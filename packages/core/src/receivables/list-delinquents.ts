import type { DelinquentCustomer } from '@na-regua/contracts'
import type { ExecutionContext } from '../context.js'
import type { DelinquencyQueries } from '../ports/delinquency-queries.js'

export type ListDelinquentsDeps = { readonly delinquency: DelinquencyQueries }

/**
 * Clientes inadimplentes, do maior valor vencido para o menor — RF-071.
 *
 * Leitura, e aberta a qualquer papel da loja: o contador tambem precisa saber
 * quem deve. A ordem e por valor porque e por onde a cobranca comeca.
 */
export async function listDelinquentCustomers(
  deps: ListDelinquentsDeps,
  ctx: ExecutionContext,
): Promise<readonly DelinquentCustomer[]> {
  return deps.delinquency.list(ctx.companyId)
}
