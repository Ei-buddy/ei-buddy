import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '../context.js'
import {
  type CandidatoAReposicao,
  inicioDaJanela,
  suggestRestock,
  sugestaoDeReposicao,
} from './restock.js'

const ctx: ExecutionContext = {
  companyId: 'emp-1',
  userId: 'u-1',
  role: 'accountant',
  channel: 'app',
  requestId: 'r-1',
  now: new Date('2026-11-05T15:00:00.000Z'),
}

const produto = (over: Partial<CandidatoAReposicao>): CandidatoAReposicao => ({
  productId: 'p',
  description: 'Produto',
  internalCode: 'PROD-1',
  unitOfMeasure: 'un',
  stock: 0,
  minStock: 0,
  vendido: 0,
  ...over,
})

describe('sugestao de reposicao — vendas dos ultimos 6 meses', () => {
  it('media do mes menos o estoque, arredondada para cima', () => {
    /* 60 em seis meses: 10 por mes; com 4 em estoque faltam 6. */
    expect(sugestaoDeReposicao(produto({ vendido: 60, stock: 4 }))).toEqual({
      quantidade: 6,
      motivo: 'vendas',
      media: 10,
    })
    /* 10 em seis meses: 1,7 por mes — compra 2. */
    expect(sugestaoDeReposicao(produto({ vendido: 10 })).quantidade).toBe(2)
  })

  it('estoque que cobre o mes nao sugere nada', () => {
    expect(sugestaoDeReposicao(produto({ vendido: 60, stock: 10 })).quantidade).toBe(0)
  })

  it('estoque negativo aparece mesmo sem venda e sem minimo', () => {
    /* Achado do QA: o negativo nao aparecia. */
    expect(sugestaoDeReposicao(produto({ stock: -3 }))).toMatchObject({
      quantidade: 3,
      motivo: 'negativo',
    })
    /* Com venda, o negativo soma na conta da media. */
    expect(sugestaoDeReposicao(produto({ vendido: 12, stock: -3 })).quantidade).toBe(5)
  })

  it('o minimo continua valendo para quem ainda nao vendeu', () => {
    expect(sugestaoDeReposicao(produto({ minStock: 5, stock: 1 }))).toMatchObject({
      quantidade: 4,
      motivo: 'minimo',
    })
  })
})

describe('suggestRestock', () => {
  it('pede a janela de seis meses e ordena do que mais falta', async () => {
    const pedidos: string[] = []
    const r = await suggestRestock(
      {
        restock: {
          candidates: async (_e, since) => {
            pedidos.push(since)
            return [
              produto({ productId: 'a', description: 'Arroz', vendido: 30, stock: 1 }),
              produto({ productId: 'b', description: 'Bala', vendido: 6, stock: 5 }),
              produto({ productId: 'c', description: 'Cafe', vendido: 120, stock: 2 }),
            ]
          },
        },
      },
      ctx,
    )

    expect(pedidos).toEqual(['2026-05-05'])
    expect(r.items.map((i) => [i.description, i.suggestedQuantity])).toEqual([
      ['Cafe', 18],
      ['Arroz', 4],
    ])
  })

  it('a janela recua seis meses no calendario', () => {
    expect(inicioDaJanela(new Date('2026-03-31T12:00:00Z'))).toBe('2025-10-01')
  })
})
