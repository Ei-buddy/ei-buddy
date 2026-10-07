import { describe, expect, it } from 'vitest'
import { ehConcordanciaPura } from './acceptance-guard.js'
import type { ResumoDeEntidades } from './conversation-context.js'

const resumo: ResumoDeEntidades = {
  entidades: [
    { tipo: 'cliente', ref: 'cli-1', rotulo: 'João' },
    { tipo: 'produto', ref: 'p-cafe', rotulo: 'café em grãos' },
  ],
}

describe('ehConcordanciaPura — a trava do aceite', () => {
  it.each([
    'sim',
    'Sim!',
    'pode',
    'fechou',
    'isso aí',
    'isso ai',
    'manda ver',
    'confirmo',
    'ok',
    '👍',
    'pode sim, obrigado',
  ])('aceita "%s"', (texto) => {
    expect(ehConcordanciaPura(texto, resumo)).toBe(true)
  })

  it.each([
    ['dígito', 'não, são 3'],
    ['dígito sem ressalva', 'sim 2'],
    ['valor', 'pode, R$ 20'],
    ['reais', 'sim, vinte reais'],
    ['pagamento', 'pode, mas no pix'],
    ['pagamento sozinho', 'fechou no dinheiro'],
    ['cartão', 'sim no cartão'],
    ['fiado', 'pode ser fiado'],
    ['nome do resumo', 'sim, pro João'],
    ['produto do resumo', 'sim, café em grãos'],
    ['ressalva mas', 'sim mas depois'],
    ['ressalva né', 'é isso né'],
    ['ressalva acho', 'acho que sim'],
    ['ressalva talvez', 'talvez'],
    ['negação', 'não'],
    ['pergunta', 'pode?'],
    ['troca', 'troca o pagamento'],
    ['longa demais', 'pode registrar esse pedido para mim agora'],
  ])('recusa com %s: "%s"', (_motivo, texto) => {
    expect(ehConcordanciaPura(texto, resumo)).toBe(false)
  })

  it('compara sem acento e sem caixa', () => {
    expect(ehConcordanciaPura('SIM, JOAO', resumo)).toBe(false)
    expect(ehConcordanciaPura('Pódé', resumo)).toBe(true)
  })
})
