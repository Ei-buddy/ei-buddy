import { describe, expect, it } from 'vitest'
import {
  adjustStockInputSchema,
  checkStockByQueryInputSchema,
  listPayablesInputSchema,
  movementKindSchema,
  stockViewOutputSchema,
} from './movement.js'

const valido = { productId: 'prod-1', countedQuantity: 18, reason: 'Contagem de inventario' }

describe('ajuste de estoque — RF-023', () => {
  it('aceita contagem com motivo', () => {
    expect(adjustStockInputSchema.parse(valido).countedQuantity).toBe(18)
  })

  /* Ajuste sem motivo vira um numero que mudou sozinho, e daqui a tres meses
     ninguem reconstroi por que o saldo caiu. */
  it('exige motivo', () => {
    const { reason: _fora, ...semMotivo } = valido
    expect(adjustStockInputSchema.safeParse(semMotivo).success).toBe(false)
  })

  it('recusa motivo curto demais para dizer alguma coisa', () => {
    expect(adjustStockInputSchema.safeParse({ ...valido, reason: 'x' }).success).toBe(false)
  })

  it('apara o motivo', () => {
    expect(adjustStockInputSchema.parse({ ...valido, reason: '  Quebra  ' }).reason).toBe('Quebra')
  })

  it('recusa contagem fracionada — a unidade e inteira', () => {
    expect(adjustStockInputSchema.safeParse({ ...valido, countedQuantity: 1.5 }).success).toBe(
      false,
    )
  })

  /* Contar negativo nao e divergencia, e erro de digitacao. O saldo pode ficar
     negativo por venda sem estoque (RF-028), mas ninguem CONTA menos que zero
     na prateleira. */
  it('recusa contagem negativa', () => {
    expect(adjustStockInputSchema.safeParse({ ...valido, countedQuantity: -1 }).success).toBe(false)
  })

  it('aceita contagem zero — acabou e um resultado legitimo', () => {
    expect(adjustStockInputSchema.parse({ ...valido, countedQuantity: 0 }).countedQuantity).toBe(0)
  })

  it('recusa campo desconhecido — o schema e strict', () => {
    expect(adjustStockInputSchema.safeParse({ ...valido, delta: -2 }).success).toBe(false)
  })
})

describe('causa do movimento', () => {
  it.each(['adjustment', 'sale', 'sale_cancelled', 'sale_returned'])('aceita %s', (k) => {
    expect(movementKindSchema.parse(k)).toBe(k)
  })

  it('recusa causa que nao existe', () => {
    expect(movementKindSchema.safeParse('sumiu').success).toBe(false)
  })
})

describe('visao de estoque — RF-022', () => {
  const base = {
    productId: 'prod-1',
    description: 'Arroz 5kg',
    salePriceCents: 2890,
    location: null,
    minStock: null,
    belowMinimum: false,
  }

  /* O ponto da RF-022: nulo e zero sao respostas diferentes, e o schema tem de
     deixar as duas passarem para que o caso de uso possa distingui-las. */
  it('aceita saldo nulo — produto sem controle de estoque', () => {
    expect(stockViewOutputSchema.parse({ ...base, stockQuantity: null }).stockQuantity).toBeNull()
  })

  it('aceita saldo zero — acabou', () => {
    expect(stockViewOutputSchema.parse({ ...base, stockQuantity: 0 }).stockQuantity).toBe(0)
  })

  it('aceita saldo negativo — venda sem estoque deixa o saldo devendo (RF-028)', () => {
    expect(stockViewOutputSchema.parse({ ...base, stockQuantity: -5 }).stockQuantity).toBe(-5)
  })
})

describe('inputs de consulta conversacional — NR-115', () => {
  it('aceita uma busca de produto preenchida e recusa texto vazio ou campos extras', () => {
    expect(checkStockByQueryInputSchema.parse({ query: ' arroz 5kg ' })).toEqual({
      query: 'arroz 5kg',
    })
    expect(checkStockByQueryInputSchema.safeParse({ query: '   ' }).success).toBe(false)
    expect(
      checkStockByQueryInputSchema.safeParse({ query: 'arroz', companyId: 'outra' }).success,
    ).toBe(false)
  })

  it('aceita somente objeto vazio para consultar contas a pagar', () => {
    expect(listPayablesInputSchema.parse({})).toEqual({})
    expect(listPayablesInputSchema.safeParse({ companyId: 'empresa-1' }).success).toBe(false)
  })
})
