import { describe, expect, it } from 'vitest'
import { createVariableCostInputSchema } from './variable-cost.js'

describe('custo variavel', () => {
  it('aceita percentual com casas decimais', () => {
    expect(
      createVariableCostInputSchema.parse({ name: 'Tarifa do cartao', ratePercent: 3.5 }),
    ).toEqual({ name: 'Tarifa do cartao', ratePercent: 3.5 })
  })

  it('recusa zero e acima de 100%', () => {
    expect(
      createVariableCostInputSchema.safeParse({ name: 'Imposto', ratePercent: 0 }).success,
    ).toBe(false)
    expect(
      createVariableCostInputSchema.safeParse({ name: 'Imposto', ratePercent: 101 }).success,
    ).toBe(false)
  })
})
