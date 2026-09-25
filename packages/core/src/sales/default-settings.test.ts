import { describe, expect, it } from 'vitest'
import { createDefaultSaleSettings } from './default-settings.js'

describe('tarifas padrao de cartao — RF-007', () => {
  it('cobre de 1x a 12x, e parcelar nunca sai mais barato', async () => {
    const { cardFees } = await createDefaultSaleSettings().forSale('empresa', 'owner')

    /* Uma linha por numero de parcelas: sem ela o dominio recusa a venda. */
    const taxas = Array.from(
      { length: 12 },
      (_, i) => cardFees.rates.find((r) => r.installments === i + 1)?.feeRatePercent,
    )
    expect(taxas).not.toContain(undefined)

    expect(taxas[0]).toBe(3)
    expect(taxas[2]).toBe(6)
    for (let i = 1; i < taxas.length; i++) expect(taxas[i]!).toBeGreaterThan(taxas[i - 1]!)
  })
})
