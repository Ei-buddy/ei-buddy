import { AppError } from '@na-regua/core'
import { describe, expect, it } from 'vitest'
import { formatarCentavos } from './format.js'
import { erroHumano, pagamento, reais, semVazios } from './views.js'

describe('visoes base', () => {
  it('reais formata centavos no padrao brasileiro', () => {
    expect(reais(2_500)).toBe(formatarCentavos(2_500))
    expect(reais(2_500)).toMatch(/R\$\s?25,00/)
  })

  it('pagamento traduz a forma de pagamento', () => {
    expect(pagamento('cash')).toBe('dinheiro')
    expect(pagamento('pix')).toBe('pix')
    expect(pagamento('debit')).toBe('débito')
    expect(pagamento('credit')).toBe('crédito')
    expect(pagamento('wallet')).toBe('fiado')
  })

  it('semVazios tira nulo, indefinido e string vazia', () => {
    expect(semVazios({ a: 1, b: null, c: undefined, d: '', e: 'x' })).toEqual({ a: 1, e: 'x' })
  })

  it('erroHumano usa a mensagem do AppError e nunca o path', () => {
    const erro = AppError.validation('Preco de venda menor que o custo. Confira os valores.', [
      { path: 'salePriceCents', message: 'menor que o custo' },
    ])
    const saida = erroHumano(erro)
    expect(saida).toEqual({
      status: 'recusado',
      mensagem: 'Preco de venda menor que o custo. Confira os valores.',
    })
    expect(JSON.stringify(saida)).not.toContain('salePriceCents')
  })
})
