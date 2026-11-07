import { describe, expect, it } from 'vitest'
import {
  calcularDre,
  calcularDreGerencial,
  type GrupoDoDre,
  type LancamentoDoPeriodo,
} from './dre.js'
import { DomainError } from './domain-error.js'

const l = (tipo: LancamentoDoPeriodo['tipo'], amountCents: number): LancamentoDoPeriodo => ({
  tipo,
  amountCents,
})

describe('DRE simplificado — RF-085', () => {
  /** Mes tipico: R$ 10.000 de venda, R$ 800 de imposto e tarifa, R$ 6.000 de
      custo, R$ 2.000 de despesa. Sobra R$ 1.200. */
  const mes = [
    l('revenue', 1_000_000),
    l('deduction', 80_000),
    l('cost', 600_000),
    l('expense', 200_000),
  ]

  it('a ordem das subtracoes fecha o resultado', () => {
    const d = calcularDre(mes)

    expect(d.receitaBruta.cents).toBe(1_000_000n)
    expect(d.receitaLiquida.cents).toBe(920_000n)
    expect(d.lucroBruto.cents).toBe(320_000n)
    expect(d.resultado.cents).toBe(120_000n)
  })

  it('soma varios lancamentos do mesmo tipo', () => {
    const d = calcularDre([l('expense', 100_000), l('expense', 50_000), l('revenue', 300_000)])

    expect(d.despesas.cents).toBe(150_000n)
  })

  /* Mes no vermelho e resultado negativo, nao zero: esconder o prejuizo faria
     o relatorio mentir justamente quando ele mais importa. */
  it('mes no vermelho da resultado negativo', () => {
    const d = calcularDre([l('revenue', 100_000), l('cost', 80_000), l('expense', 50_000)])

    expect(d.resultado.cents).toBe(-30_000n)
    expect(d.resultado.isNegative()).toBe(true)
  })

  it('periodo sem movimento nenhum da tudo zero', () => {
    const d = calcularDre([])

    expect(d.receitaBruta.isZero()).toBe(true)
    expect(d.resultado.isZero()).toBe(true)
  })

  it('despesa sem receita e prejuizo do tamanho da despesa', () => {
    const d = calcularDre([l('expense', 200_000)])

    expect(d.resultado.cents).toBe(-200_000n)
  })
})

describe('margem bruta', () => {
  it('sai em PONTOS, como o resto do sistema', () => {
    /* Receita 1.000,00; custo 600,00 → lucro bruto 400,00 → 40 pontos. */
    const d = calcularDre([l('revenue', 100_000), l('cost', 60_000)])

    expect(d.margemBrutaPontos).toBe(40)
  })

  it('arredonda para duas casas — 12,4% e 12,6% sao diferentes na conta do mes', () => {
    const d = calcularDre([l('revenue', 100_000), l('cost', 87_550)])

    expect(d.margemBrutaPontos).toBe(12.45)
  })

  /* Dividir por zero daria Infinity, e "margem: Infinity%" e pior que "—". */
  it('sem receita a margem e nula, nao zero nem Infinity', () => {
    const d = calcularDre([l('expense', 50_000)])

    expect(d.margemBrutaPontos).toBeNull()
  })

  it('margem negativa aparece negativa', () => {
    const d = calcularDre([l('revenue', 100_000), l('cost', 120_000)])

    expect(d.margemBrutaPontos).toBe(-20)
  })

  it('a deducao entra na margem — ela e sobre a receita liquida', () => {
    const semDeducao = calcularDre([l('revenue', 100_000), l('cost', 60_000)])
    const comDeducao = calcularDre([
      l('revenue', 100_000),
      l('deduction', 10_000),
      l('cost', 60_000),
    ])

    expect(semDeducao.margemBrutaPontos).toBe(40)
    expect(comDeducao.margemBrutaPontos).toBe(30)
  })
})

/**
 * O sinal vem do TIPO, nunca do valor. Um negativo aqui viraria uma despesa que
 * aumenta o lucro — e ninguem conferiria, porque o total continuaria fechando.
 */
describe('lancamento invalido', () => {
  it('recusa valor negativo', () => {
    expect(() => calcularDre([l('expense', -100)])).toThrow(DomainError)
  })

  it('recusa centavo fracionado', () => {
    expect(() => calcularDre([l('revenue', 100.5)])).toThrow(DomainError)
  })

  it('aceita zero — lancamento de valor zero existe e nao atrapalha', () => {
    expect(calcularDre([l('revenue', 0)]).receitaBruta.isZero()).toBe(true)
  })
})

describe('DRE gerencial — margem de contribuicao (achado do QA)', () => {
  const g = (grupo: GrupoDoDre, amountCents: number) => ({ grupo, amountCents })

  /** R$ 10.000 vendidos, R$ 500 de desconto, R$ 300 de imposto, R$ 200 de
      tarifa, R$ 5.000 de mercadoria; aluguel R$ 2.000 e energia R$ 500. */
  const mes = [
    g('vendas', 1_000_000),
    g('descontos', 50_000),
    g('custos_variaveis', 30_000),
    g('custos_variaveis', 20_000),
    g('custos_variaveis', 500_000),
    g('despesas', 200_000),
    g('despesas', 50_000),
  ]

  it('vendas brutas, descontos, venda liquida, custos variaveis, margem e resultado', () => {
    const d = calcularDreGerencial(mes)

    expect(d.vendasBrutas.cents).toBe(1_000_000n)
    expect(d.descontos.cents).toBe(50_000n)
    expect(d.vendaLiquida.cents).toBe(950_000n)
    expect(d.custosVariaveis.cents).toBe(550_000n)
    expect(d.margemDeContribuicao.cents).toBe(400_000n)
    expect(d.despesas.cents).toBe(250_000n)
    expect(d.resultadoOperacional.cents).toBe(150_000n)
  })

  it('a margem de contribuicao e sobre a venda liquida, em pontos', () => {
    /* 400.000 / 950.000 = 42,105...% → 42,11 */
    expect(calcularDreGerencial(mes).margemDeContribuicaoPontos).toBe(42.11)
  })

  it('sem venda, a margem e nula (nada de Infinity ou NaN)', () => {
    const d = calcularDreGerencial([g('despesas', 10_000)])

    expect(d.margemDeContribuicaoPontos).toBeNull()
    expect(d.resultadoOperacional.cents).toBe(-10_000n)
  })

  it('o resultado operacional e o mesmo resultado do DRE contabil', () => {
    /* A tarifa de cartao e despesa no contabil e custo variavel no gerencial;
       o imposto e deducao no contabil e custo variavel no gerencial. O total
       nao pode mudar com o reagrupamento. */
    const contabil = calcularDre([
      { tipo: 'revenue', amountCents: 1_000_000 },
      { tipo: 'deduction', amountCents: 50_000 },
      { tipo: 'deduction', amountCents: 30_000 },
      { tipo: 'expense', amountCents: 20_000 },
      { tipo: 'cost', amountCents: 500_000 },
      { tipo: 'expense', amountCents: 250_000 },
    ])
    const gerencial = calcularDreGerencial(mes)

    expect(gerencial.resultadoOperacional.cents).toBe(contabil.resultado.cents)
  })

  it('valor negativo e recusado, como no DRE contabil', () => {
    expect(() => calcularDreGerencial([g('vendas', -1)])).toThrow(DomainError)
  })
})
