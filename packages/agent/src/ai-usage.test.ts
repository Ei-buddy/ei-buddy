import { describe, expect, it } from 'vitest'
import { InMemoryAiUsageCounter } from './ai-usage.js'

const setembro = new Date('2026-09-16T18:00:00.000Z')

describe('InMemoryAiUsageCounter', () => {
  it('mede por empresa e mes civil YYYY-MM', () => {
    const uso = new InMemoryAiUsageCounter({ timeZone: 'America/Sao_Paulo' })
    expect(uso.periodOf(setembro)).toBe('2026-09')
    expect(uso.unitsOf('emp-1', setembro)).toBe(0)

    expect(uso.record('emp-1', setembro)).toBe(1)
    expect(uso.record('emp-1', setembro, 2)).toBe(3)
    expect(uso.unitsOf('emp-1', setembro)).toBe(3)
    expect(uso.unitsOf('emp-2', setembro)).toBe(0)
  })

  it('isola o mes seguinte', () => {
    const uso = new InMemoryAiUsageCounter({ timeZone: 'America/Sao_Paulo' })
    uso.record('emp-1', setembro, 4)
    const outubroSp = new Date('2026-10-01T03:00:00.000Z')
    expect(uso.periodOf(outubroSp)).toBe('2026-10')
    expect(uso.unitsOf('emp-1', outubroSp)).toBe(0)
  })

  it('sem teto nunca estoura', () => {
    const uso = new InMemoryAiUsageCounter()
    uso.record('emp-1', setembro, 99)
    expect(uso.budgetCents).toBeUndefined()
    expect(uso.isOverBudget('emp-1', setembro)).toBe(false)
  })

  it('estoura quando as unidades atingem o teto em centavos', () => {
    const uso = new InMemoryAiUsageCounter({ budgetCents: 2 })
    expect(uso.isOverBudget('emp-1', setembro)).toBe(false)
    uso.record('emp-1', setembro, 2)
    expect(uso.isOverBudget('emp-1', setembro)).toBe(true)
    expect(uso.isOverBudget('emp-2', setembro)).toBe(false)
  })
})
