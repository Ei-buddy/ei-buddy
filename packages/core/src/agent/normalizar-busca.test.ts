import { describe, expect, it } from 'vitest'
import { normalizarParaBusca } from './normalizar-busca.js'

/**
 * A normalizacao da busca — NR-120, RF-102.
 *
 * Ela roda nos DOIS lados: em quem grava o trecho e em quem consulta. Se so um
 * normalizasse, "Sabão em pó" nunca encontraria "sabao em po" — e o sintoma
 * seria o assistente dizendo que o produto nao existe.
 */
describe('normalizar para busca', () => {
  it('tira acento, que e o caso que mais aparece no balcao', () => {
    /* Quem digita no celular quase nunca acentua. */
    expect(normalizarParaBusca('Sabão em pó')).toBe('sabao em po')
    expect(normalizarParaBusca('Açúcar Cristal')).toBe('acucar cristal')
    expect(normalizarParaBusca('Pão de Açúcar')).toBe('pao de acucar')
  })

  it('tira caixa', () => {
    expect(normalizarParaBusca('COCA-COLA')).toBe('coca-cola')
  })

  it('colapsa espaco, inclusive quebra de linha', () => {
    /* Texto colado de outro lugar chega com espaco duplo e \n no meio. */
    expect(normalizarParaBusca('  Arroz   tipo\n1  ')).toBe('arroz tipo 1')
  })

  it('e idempotente', () => {
    /* Precisa ser: o trecho gravado ja normalizado pode ser reindexado, e
       normalizar de novo nao pode mudar nada. */
    const uma = normalizarParaBusca('Feijão Carioca 1kg')
    expect(normalizarParaBusca(uma)).toBe(uma)
  })

  it('os dois lados se encontram', () => {
    /* A propriedade que importa, escrita como propriedade. */
    expect(normalizarParaBusca('Sabão em Pó OMO')).toBe(normalizarParaBusca('sabao em po omo'))
  })

  it('texto so de espaco vira vazio, e nao quebra', () => {
    expect(normalizarParaBusca('   ')).toBe('')
  })

  it('nao mexe em numero nem em hifen', () => {
    /* "2l" e "1kg" sao o que distingue um produto do outro; remover digito
       faria "coca 2l" e "coca 600ml" virarem a mesma coisa. */
    expect(normalizarParaBusca('Coca-Cola 2L')).toBe('coca-cola 2l')
  })
})
