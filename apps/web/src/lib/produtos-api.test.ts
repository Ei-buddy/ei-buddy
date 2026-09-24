import { describe, expect, it } from 'vitest'
import { centavosDaPlanilha, inteiroDaPlanilha } from './produtos-api'

/*
 * Os dois conversores tinham `[^d,.-]` no lugar de `[^\d,.-]`: apagavam TODO
 * digito. Toda planilha importava com preco zero e quantidade vazia, e o
 * formulario de produto — que passou a usar o mesmo conversor — herdaria isso.
 */
describe('centavosDaPlanilha', () => {
  it.each([
    ['12,90', 1290],
    ['12.90', 1290],
    ['R$ 12,90', 1290],
    ['1.234,56', 123456],
    ['1.234', 123400],
    ['10', 1000],
    ['8.5', 850],
  ])('le %s como %i centavos', (texto, centavos) => {
    expect(centavosDaPlanilha(texto)).toBe(centavos)
  })

  it('devolve null, e nao zero, quando nao ha numero', () => {
    expect(centavosDaPlanilha('')).toBeNull()
    expect(centavosDaPlanilha(undefined)).toBeNull()
    expect(centavosDaPlanilha('abc')).toBeNull()
  })
})

describe('inteiroDaPlanilha', () => {
  it('le a quantidade', () => {
    expect(inteiroDaPlanilha('40')).toBe(40)
    expect(inteiroDaPlanilha(' 40 un ')).toBe(40)
  })

  it('devolve null quando nao ha numero', () => {
    expect(inteiroDaPlanilha('')).toBeNull()
  })
})
