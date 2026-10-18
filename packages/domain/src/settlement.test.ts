import { describe, expect, it } from 'vitest'
import { DomainError } from './domain-error.js'
import { aplicarBaixa, estornarBaixa, situacaoPorValor } from './settlement.js'

describe('situacao por valor', () => {
  it.each([
    [10_000, 0, 'open'],
    [10_000, 4_000, 'partially_settled'],
    [10_000, 10_000, 'settled'],
  ] as const)('titulo de %i com %i baixado esta %s', (valor, baixado, esperado) => {
    expect(situacaoPorValor(valor, baixado)).toBe(esperado)
  })

  /* Um centavo faltando ainda e divida. Arredondar para "quitado" faria o
     lojista parar de cobrar por causa de um erro de digitacao. */
  it('um centavo a menos ainda e parcial', () => {
    expect(situacaoPorValor(10_000, 9_999)).toBe('partially_settled')
  })
})

describe('baixa — RF-059, RF-066', () => {
  it('baixa total quita o titulo', () => {
    expect(aplicarBaixa(10_000, 0, 10_000)).toEqual({
      settledAmountCents: 10_000,
      status: 'settled',
    })
  })

  it('baixa parcial deixa o titulo em aberto parcial', () => {
    expect(aplicarBaixa(10_000, 0, 4_000)).toEqual({
      settledAmountCents: 4_000,
      status: 'partially_settled',
    })
  })

  it('baixas parciais somam ate quitar', () => {
    const primeira = aplicarBaixa(10_000, 0, 4_000)
    const segunda = aplicarBaixa(10_000, primeira.settledAmountCents, 6_000)

    expect(segunda).toEqual({ settledAmountCents: 10_000, status: 'settled' })
  })

  /**
   * Valor a maior digitado por engano ficaria como credito invisivel dentro do
   * titulo, e o lojista so descobriria conferindo o extrato meses depois.
   */
  it('recusa pagar mais do que se deve', () => {
    expect(() => aplicarBaixa(10_000, 0, 10_001)).toThrow(DomainError)
  })

  it('recusa pagar mais do que o saldo restante', () => {
    expect(() => aplicarBaixa(10_000, 7_000, 3_001)).toThrow(DomainError)
  })

  it('aceita exatamente o saldo restante', () => {
    expect(aplicarBaixa(10_000, 7_000, 3_000).status).toBe('settled')
  })

  it('recusa baixar titulo ja quitado', () => {
    try {
      aplicarBaixa(10_000, 10_000, 1)
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(erro instanceof DomainError && erro.code).toBe('ALREADY_SETTLED')
    }
  })

  it.each([0, -100, 50.5])('recusa baixa de %s', (valor) => {
    expect(() => aplicarBaixa(10_000, 0, valor)).toThrow(DomainError)
  })

  it('distingue passar do saldo de valor invalido', () => {
    try {
      aplicarBaixa(10_000, 0, 20_000)
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(erro instanceof DomainError && erro.code).toBe('SETTLEMENT_EXCEEDS_BALANCE')
    }
  })
})

describe('estorno — RF-060, RF-067', () => {
  it('estorno de baixa total devolve o titulo a aberto', () => {
    expect(estornarBaixa(10_000, 10_000, 10_000)).toEqual({
      settledAmountCents: 0,
      status: 'open',
    })
  })

  /**
   * Volta ao estado anterior AQUELA baixa, nao ao inicial: se houve tres e a
   * segunda foi estornada, as outras duas continuam de pe.
   */
  it('estorno de uma entre varias preserva as demais', () => {
    /* Baixou 4.000 e depois 3.000; estorna so a de 3.000. */
    const r = estornarBaixa(10_000, 7_000, 3_000)

    expect(r).toEqual({ settledAmountCents: 4_000, status: 'partially_settled' })
  })

  it('recusa estornar mais do que foi baixado', () => {
    expect(() => estornarBaixa(10_000, 4_000, 4_001)).toThrow(DomainError)
  })

  it.each([0, -1])('recusa estorno de %s', (valor) => {
    expect(() => estornarBaixa(10_000, 4_000, valor)).toThrow(DomainError)
  })

  it('baixar e estornar o mesmo valor volta ao ponto de partida', () => {
    const depois = aplicarBaixa(10_000, 2_500, 3_000)
    const voltou = estornarBaixa(10_000, depois.settledAmountCents, 3_000)

    expect(voltou.settledAmountCents).toBe(2_500)
    expect(voltou.status).toBe('partially_settled')
  })
})

describe('mensagem da baixa acima do saldo', () => {
  /* Saia "A baixa de 999999 passa do saldo devedor de 1698" — centavos crus na tela. */
  it('fala em reais', () => {
    expect(() => aplicarBaixa(1698, 0, 999999)).toThrow(/R\$\s?9\.999,99.*R\$\s?16,98/)
  })
})
