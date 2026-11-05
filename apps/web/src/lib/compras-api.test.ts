import { describe, expect, it } from 'vitest'
import { parcelasIguais, somarMeses } from './compras-api'

describe('parcelas da entrada de mercadoria', () => {
  it('soma meses segurando o fim do mes', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(somarMeses('2026-11-15', 2)).toBe('2027-01-15')
  })

  it('divide igual, com a sobra na primeira, e fecha com o total', () => {
    const p = parcelasIguais(10_000, 3, '2026-11-10')
    expect(p.map((x) => x.amountCents)).toEqual([3334, 3333, 3333])
    expect(p.map((x) => x.dueDate)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10'])
  })
})
