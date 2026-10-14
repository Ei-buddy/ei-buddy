import type { DelinquentCustomer } from '@na-regua/contracts'
import type { CompanyId } from '../context.js'

/** Inadimplentes — RF-071. "Hoje" e o do fuso da loja, calculado no banco. */
export type DelinquencyQueries = {
  list(companyId: CompanyId): Promise<readonly DelinquentCustomer[]>
}
