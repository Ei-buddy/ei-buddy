import { CONTA_DINHEIRO_DO_CAIXA as doContrato } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { CONTA_DINHEIRO_DO_CAIXA } from './financeiro-api'

/* A copia do web contra o contrato (DEC-025): se o nome mudar so de um lado,
   a baixa com "Dinheiro do caixa" passa a ser recusada pelo servidor. */
describe('dinheiro do caixa: a copia do web e o contrato', () => {
  it('sao o mesmo nome', () => {
    expect(CONTA_DINHEIRO_DO_CAIXA).toBe(doContrato)
  })
})
