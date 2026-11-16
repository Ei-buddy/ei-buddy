import {
  cardBrandSchema,
  paymentFeeSettingsInputSchema,
  paymentFeeSettingsOutputSchema,
  MAX_PARCELAS_DA_TABELA,
} from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import {
  BANDEIRAS,
  formularioDe,
  PARCELAS_DA_TABELA,
  parcelasOferecidas,
  percentualDoTexto,
  rotuloDaTaxa,
  TAXAS_PADRAO,
  taxaDaForma,
  taxasDoFormulario,
  type TabelaDeTaxas,
} from './taxas-api'
import { taxaDoPagamento, valorLiquido, type Pagamento } from './vendas-api'

/** Taxas de recebimento na tela — DEC-027 (NR-224). */

const DA_LOJA: TabelaDeTaxas = {
  pixFeePercent: 0.99,
  debitFeePercent: 1.49,
  creditFeePercents: [2.99, 4.5, 5.25],
  brandOverrides: [{ brand: 'amex', method: 'credit', installments: 1, feePercent: 3.99 }],
  debitSettlementDays: 1,
  creditSettlementDays: 30,
  anticipation: { enabled: false, monthlyRatePercent: null },
  isDefault: false,
  updatedAt: '2026-11-16T13:00:00.000Z',
}

describe('copias do contrato e de core', () => {
  it('a tabela padrao passa no contrato e e a mesma de core (3%, 5%, +1,5 ponto)', () => {
    expect(paymentFeeSettingsOutputSchema.parse(TAXAS_PADRAO)).toEqual(TAXAS_PADRAO)
    expect(TAXAS_PADRAO.creditFeePercents).toEqual([
      3, 5, 6, 7.5, 9, 10.5, 12, 13.5, 15, 16.5, 18, 19.5,
    ])
    expect(TAXAS_PADRAO.debitFeePercent).toBe(3)
    expect(TAXAS_PADRAO.pixFeePercent).toBe(0)
  })

  it('mesmo numero de parcelas e as mesmas bandeiras do contrato', () => {
    expect(PARCELAS_DA_TABELA).toBe(MAX_PARCELAS_DA_TABELA)
    expect(BANDEIRAS.map((b) => b.valor)).toEqual(
      cardBrandSchema.options.filter((b) => b !== 'unknown'),
    )
  })
})

describe('a previsao do PDV usa a tabela da loja', () => {
  it('taxa geral por forma e parcela; parcela nao configurada e null', () => {
    expect(taxaDaForma(DA_LOJA, 'pix')).toBe(0.99)
    expect(taxaDaForma(DA_LOJA, 'debito')).toBe(1.49)
    expect(taxaDaForma(DA_LOJA, 'credito', 1)).toBe(2.99)
    expect(taxaDaForma(DA_LOJA, 'credito', 3)).toBe(5.25)
    expect(taxaDaForma(DA_LOJA, 'credito', 4)).toBeNull()
    expect(taxaDaForma(DA_LOJA, 'dinheiro')).toBe(0)
    expect(taxaDaForma(DA_LOJA, 'carteira')).toBe(0)
    expect(parcelasOferecidas(DA_LOJA)).toBe(3)
  })

  it('liquido do PDV = pago - taxa da loja (e nao mais 0,99/1,99/3,49 fixos)', () => {
    const pagamentos: Pagamento[] = [
      { id: 'a', forma: 'pix', valor: 100, status: 'confirmado' },
      { id: 'b', forma: 'credito', valor: 100, status: 'confirmado', parcelas: 2 },
      { id: 'c', forma: 'debito', valor: 100, status: 'pendente' },
    ]
    expect(taxaDoPagamento(pagamentos[1]!, DA_LOJA)).toBeCloseTo(4.5)
    expect(valorLiquido(pagamentos, DA_LOJA)).toBeCloseTo(200 - 0.99 - 4.5)
    /* Loja sem configuracao: a padrao, igual ao servidor. */
    expect(valorLiquido(pagamentos, TAXAS_PADRAO)).toBeCloseTo(200 - 0 - 5)
  })

  it('rotulo', () => {
    expect(rotuloDaTaxa(0)).toBe('sem taxa')
    expect(rotuloDaTaxa(2.99)).toBe('taxa 2,99%')
    expect(rotuloDaTaxa(null)).toBe('sem taxa configurada')
  })
})

describe('formulario', () => {
  it('ida e volta: o formulario da tabela monta a mesma tabela, e passa no contrato', () => {
    const f = formularioDe(DA_LOJA)
    expect(f.credito).toHaveLength(12)
    expect(f.credito.slice(0, 4)).toEqual(['2,99', '4,5', '5,25', ''])
    const r = taxasDoFormulario(f)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { isDefault: _i, updatedAt: _u, ...semMeta } = DA_LOJA
    expect(r.dados).toEqual(semMeta)
    expect(paymentFeeSettingsInputSchema.parse(r.dados)).toEqual(r.dados)
  })

  it('aceita virgula, ponto e %; recusa negativa, acima de 30 e tres casas', () => {
    expect(percentualDoTexto('2,99')).toBe(2.99)
    expect(percentualDoTexto(' 3.5 % ')).toBe(3.5)
    expect(percentualDoTexto('0')).toBe(0)
    for (const v of ['-1', '31', '1,999', 'abc', '']) expect(percentualDoTexto(v), v).toBeNull()
  })

  it('parcela vazia no meio e erro com o nome da parcela; vazias no fim sao cortadas', () => {
    const f = formularioDe(DA_LOJA)
    const furada = { ...f, credito: ['3', '', '6', ...f.credito.slice(3)] }
    const r = taxasDoFormulario(furada)
    expect(r).toEqual({
      ok: false,
      erro: 'Preencha a taxa do crédito em 2x ou apague as parcelas depois dela.',
    })
    const sem = taxasDoFormulario({ ...f, credito: Array(12).fill('') })
    expect(sem.ok).toBe(false)
  })

  it('erro diz o campo; excecao repetida e recusada; debito vira 1x', () => {
    const f = formularioDe(DA_LOJA)
    expect(taxasDoFormulario({ ...f, pix: '40' })).toMatchObject({ ok: false, erro: /Pix/ })
    expect(taxasDoFormulario({ ...f, diasDebito: '61' })).toMatchObject({
      ok: false,
      erro: /Prazo/,
    })

    const repetida = {
      ...f,
      excecoes: [
        { bandeira: 'elo' as const, forma: 'debit' as const, parcelas: 1, taxa: '2' },
        { bandeira: 'elo' as const, forma: 'debit' as const, parcelas: 5, taxa: '3' },
      ],
    }
    expect(taxasDoFormulario(repetida)).toEqual({
      ok: false,
      erro: 'Elo no débito aparece duas vezes.',
    })

    const debito = taxasDoFormulario({ ...f, excecoes: [repetida.excecoes[1]!] })
    expect(debito.ok && debito.dados.brandOverrides[0]?.installments).toBe(1)
  })

  it('antecipacao em branco vira null; com valor, numero', () => {
    const f = formularioDe(DA_LOJA)
    const r = taxasDoFormulario({ ...f, antecipacao: true, taxaAntecipacao: '1,79' })
    expect(r.ok && r.dados.anticipation).toEqual({ enabled: true, monthlyRatePercent: 1.79 })
  })
})
