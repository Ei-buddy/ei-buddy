import { describe, expect, it } from 'vitest'
import { reaisDoTexto } from './valor'

/* Os casos que as telas erravam: o ponto decimal lido como milhar, e o
   "R$ 1.500" que virava zero. `centavosDoTexto` ja e coberto pelos testes
   de produtos-api, pela `centavosDaPlanilha`. */
describe('reaisDoTexto', () => {
  it.each([
    ['12.90', 12.9],
    ['12,90', 12.9],
    ['R$ 1.500', 1500],
    ['1.500,50', 1500.5],
    ['10,5', 10.5],
  ])('le %s como %d reais', (texto, reais) => {
    expect(reaisDoTexto(texto)).toBe(reais)
  })

  it('le zero quando nao ha numero', () => {
    expect(reaisDoTexto('')).toBe(0)
  })
})
