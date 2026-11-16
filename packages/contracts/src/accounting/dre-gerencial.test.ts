import { describe, expect, it } from 'vitest'
import type { DreLine, DreOutput } from './account.js'
import { linhasDoDreGerencial } from './dre-gerencial.js'

const linha = (
  group: DreLine['group'],
  accountName: string,
  amountCents: number,
  accountId: string | null = null,
): DreLine => ({
  accountId,
  accountName,
  type: 'expense',
  group,
  amountCents,
  entryCount: 1,
})

const base: DreOutput = {
  from: '2026-11-01',
  to: '2026-11-30',
  grossRevenueCents: 10_000,
  deductionsCents: 0,
  netRevenueCents: 0,
  costCents: 0,
  grossProfitCents: 0,
  expensesCents: 0,
  resultCents: 2_400,
  grossMarginPoints: null,
  discountsCents: 700,
  netSalesCents: 9_300,
  variableCostsCents: 5_000,
  contributionMarginCents: 4_300,
  contributionMarginPoints: 46.24,
  operatingExpensesCents: 1_900,
  operatingResultCents: 2_400,
  lines: [
    linha('sales', 'Vendas', 10_000),
    linha('discounts', 'Descontos concedidos', 500),
    linha('discounts', 'Devoluções', 200),
    linha('variable_costs', 'Impostos sobre vendas', 600),
    linha('variable_costs', 'Tarifas de cartão', 300),
    linha('variable_costs', 'Custo das mercadorias vendidas', 4_100),
    linha('expenses', 'Aluguel', 1_500, 'a1'),
    linha('expenses', 'Energia', 400, 'a2'),
  ],
}

describe('DRE gerencial — o formato pedido pelo QA', () => {
  it('na ordem: vendas, descontos, liquida, custos variaveis, margem, contas, resultado', () => {
    expect(linhasDoDreGerencial(base).map((l) => l.rotulo)).toEqual([
      'Vendas brutas',
      '(−) Descontos',
      'Descontos concedidos',
      'Devoluções',
      'Venda líquida',
      '(−) Custos variáveis',
      'Impostos sobre vendas',
      'Tarifas de cartão',
      'Custo das mercadorias vendidas',
      'Margem de contribuição',
      '(−) Aluguel',
      '(−) Energia',
      'Resultado operacional',
    ])
  })

  it('os tracos do formato: antes dos custos variaveis, da margem, das contas e do resultado', () => {
    expect(
      linhasDoDreGerencial(base)
        .filter((l) => l.separaAntes)
        .map((l) => l.rotulo),
    ).toEqual([
      '(−) Custos variáveis',
      'Margem de contribuição',
      '(−) Aluguel',
      'Resultado operacional',
    ])
  })

  it('margem de contribuicao com a porcentagem da venda liquida', () => {
    const margem = linhasDoDreGerencial(base).find((l) => l.chave === 'margem')
    expect(margem?.valorCents).toBe(4_300)
    expect(margem?.nota).toBe('46,24% da venda líquida')
  })

  it('uma origem so de venda ou desconto nao repete a linha como detalhe', () => {
    const r = linhasDoDreGerencial({
      ...base,
      lines: base.lines.filter((l) => l.accountName !== 'Devoluções'),
    })
    expect(r.filter((l) => l.nivel === 'detalhe').map((l) => l.rotulo)).toEqual([
      'Impostos sobre vendas',
      'Tarifas de cartão',
      'Custo das mercadorias vendidas',
    ])
  })

  it('sem despesa no periodo, a linha das contas aparece zerada (nao some)', () => {
    const r = linhasDoDreGerencial({
      ...base,
      operatingExpensesCents: 0,
      lines: base.lines.filter((l) => l.group !== 'expenses'),
    })
    const despesas = r.find((l) => l.chave === 'despesas')
    expect(despesas?.rotulo).toBe('(−) Despesas do plano de contas')
    expect(despesas?.valorCents).toBe(0)
    expect(despesas?.separaAntes).toBe(true)
  })

  it('sem venda, a margem nao inventa porcentagem', () => {
    const margem = linhasDoDreGerencial({ ...base, contributionMarginPoints: null }).find(
      (l) => l.chave === 'margem',
    )
    expect(margem?.nota).toBeUndefined()
  })
})
