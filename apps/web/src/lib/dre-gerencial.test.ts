import {
  type DreLine,
  type DreOutput,
  linhasDoDreGerencial as doContrato,
} from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { linhasDoDreGerencial } from './dre-gerencial'

/**
 * A copia do web tem de montar EXATAMENTE as linhas do contrato — as mesmas do
 * app e da exportacao para o contador (achado do QA, NR-204).
 */
const linha = (group: DreLine['group'], accountName: string, amountCents: number): DreLine => ({
  accountId: null,
  accountName,
  type: 'expense',
  group,
  amountCents,
  entryCount: 2,
})

const base: DreOutput = {
  from: '2026-11-01',
  to: '2026-11-30',
  grossRevenueCents: 11_000,
  deductionsCents: 1_300,
  netRevenueCents: 9_700,
  costCents: 5_100,
  grossProfitCents: 4_600,
  expensesCents: 2_200,
  resultCents: 2_400,
  grossMarginPoints: 41.82,
  discountsCents: 700,
  netSalesCents: 10_300,
  variableCostsCents: 6_000,
  contributionMarginCents: 4_300,
  contributionMarginPoints: 41.75,
  operatingExpensesCents: 1_900,
  operatingResultCents: 2_400,
  lines: [
    linha('sales', 'Vendas', 10_000),
    linha('sales', 'Outras receitas', 1_000),
    linha('discounts', 'Descontos concedidos', 500),
    linha('discounts', 'Devoluções', 200),
    linha('variable_costs', 'Impostos sobre vendas', 600),
    linha('variable_costs', 'Tarifas de cartão', 300),
    linha('variable_costs', 'Custo das mercadorias vendidas', 5_100),
    linha('expenses', 'Aluguel', 1_500),
    linha('expenses', 'Energia', 400),
  ],
}

describe('linhasDoDreGerencial (copia do web) = contrato', () => {
  it.each([
    ['mes completo', base],
    ['sem despesa', { ...base, lines: base.lines.filter((l) => l.group !== 'expenses') }],
    ['sem venda', { ...base, contributionMarginPoints: null, lines: [] }],
    [
      'uma venda so',
      { ...base, lines: base.lines.filter((l) => l.accountName !== 'Outras receitas') },
    ],
  ])('%s', (_nome, dre) => {
    expect(linhasDoDreGerencial(dre)).toEqual(doContrato(dre))
  })
})
