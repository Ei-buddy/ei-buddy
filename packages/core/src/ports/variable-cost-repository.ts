import type { VariableCostOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/** Custos variaveis da empresa — percentual sobre o preco de venda. */
export type NewVariableCost = {
  readonly companyId: CompanyId
  readonly name: string
  /** Centesimos de ponto percentual: 350 = 3,50%. */
  readonly rateBps: number
  readonly createdBy: UserId
  readonly createdAt: Date
}

export type VariableCostRepository = {
  list(companyId: CompanyId): Promise<readonly VariableCostOutput[]>
  findById(companyId: CompanyId, id: string): Promise<VariableCostOutput | undefined>
  insert(novo: NewVariableCost): Promise<VariableCostOutput>
  remove(companyId: CompanyId, id: string): Promise<void>
}
