import {
  cardBrandSchema,
  MAX_PARCELAS_DA_TABELA,
  paymentFeeSettingsInputSchema,
  paymentFeeSettingsOutputSchema,
} from '@na-regua/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Taxas de recebimento no app — DEC-027 (NR-224), as mesmas regras do web. */

const chamadas: { caminho: string; opcoes?: { method?: string; body?: unknown } }[] = []
let resposta: { ok: boolean; dados?: unknown; status?: number; code?: string; message?: string }

vi.mock('./api', () => ({
  chamarApi: vi.fn((caminho: string, opcoes?: { method?: string; body?: unknown }) => {
    chamadas.push({ caminho, ...(opcoes ? { opcoes } : {}) })
    return Promise.resolve(resposta)
  }),
}))

const {
  BANDEIRAS,
  formularioDe,
  lerTaxasDeRecebimento,
  PARCELAS_DA_TABELA,
  parcelasOferecidas,
  rotuloDaTaxa,
  salvarTaxasDeRecebimento,
  souResponsavel,
  TAXAS_PADRAO,
  taxaDaForma,
  taxasDoFormulario,
} = await import('./taxas-api.js')
const { taxaDoPagamento, valorLiquido } = await import('./vendas-api.js')

type Tabela = typeof TAXAS_PADRAO

const DA_LOJA: Tabela = {
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

beforeEach(() => {
  chamadas.length = 0
})

describe('copias do contrato e de core', () => {
  it('a tabela padrao passa no contrato e e a de core', () => {
    expect(paymentFeeSettingsOutputSchema.parse(TAXAS_PADRAO)).toEqual(TAXAS_PADRAO)
    expect(TAXAS_PADRAO.creditFeePercents).toEqual([
      3, 5, 6, 7.5, 9, 10.5, 12, 13.5, 15, 16.5, 18, 19.5,
    ])
    expect(PARCELAS_DA_TABELA).toBe(MAX_PARCELAS_DA_TABELA)
    expect(BANDEIRAS.map((b) => b.valor)).toEqual(
      cardBrandSchema.options.filter((b) => b !== 'unknown'),
    )
  })
})

describe('rotas', () => {
  it('le e grava nas mesmas rotas do web', async () => {
    resposta = { ok: true, dados: DA_LOJA }
    expect(await lerTaxasDeRecebimento()).toEqual({ ok: true, dados: DA_LOJA })
    const montado = taxasDoFormulario(formularioDe(DA_LOJA))
    if (!montado.ok) throw new Error(montado.erro)
    await salvarTaxasDeRecebimento(montado.dados)
    expect(chamadas.map((c) => [c.caminho, c.opcoes?.method ?? 'GET'])).toEqual([
      ['/taxas-de-recebimento', 'GET'],
      ['/taxas-de-recebimento', 'PUT'],
    ])
    expect(paymentFeeSettingsInputSchema.parse(chamadas[1]?.opcoes?.body)).toEqual(montado.dados)
  })

  it('erro da api vira a mensagem; so o responsavel altera', async () => {
    resposta = { ok: false, status: 403, code: 'FORBIDDEN', message: 'Somente o responsável.' }
    expect(await lerTaxasDeRecebimento()).toEqual({ ok: false, erro: 'Somente o responsável.' })
    expect(await souResponsavel()).toBe(false)
    resposta = { ok: true, dados: { role: 'owner' } }
    expect(await souResponsavel()).toBe(true)
    resposta = { ok: true, dados: { role: 'staff' } }
    expect(await souResponsavel()).toBe(false)
  })
})

describe('a previsao do PDV usa a tabela da loja', () => {
  it('taxa por forma e parcela; parcelas oferecidas = as configuradas', () => {
    expect(taxaDaForma(DA_LOJA, 'pix')).toBe(0.99)
    expect(taxaDaForma(DA_LOJA, 'credito', 2)).toBe(4.5)
    expect(taxaDaForma(DA_LOJA, 'credito', 5)).toBeNull()
    expect(parcelasOferecidas(DA_LOJA)).toBe(3)
    expect(rotuloDaTaxa(taxaDaForma(DA_LOJA, 'dinheiro'))).toBe('sem taxa')
  })

  it('liquido = pago - taxa da loja', () => {
    const pix = { id: 'a', forma: 'pix' as const, valor: 100, status: 'confirmado' as const }
    expect(taxaDoPagamento(pix, DA_LOJA)).toBeCloseTo(0.99)
    expect(valorLiquido([pix], DA_LOJA)).toBeCloseTo(99.01)
    expect(valorLiquido([pix], TAXAS_PADRAO)).toBe(100)
  })
})

describe('formulario — as mesmas regras do web', () => {
  it('parcela vazia no meio e erro; excecao de debito vira 1x', () => {
    const f = formularioDe(DA_LOJA)
    expect(taxasDoFormulario({ ...f, credito: ['3', '', '6'] })).toEqual({
      ok: false,
      erro: 'Preencha a taxa do crédito em 2x ou apague as parcelas depois dela.',
    })
    const r = taxasDoFormulario({
      ...f,
      excecoes: [{ bandeira: 'elo', forma: 'debit', parcelas: 4, taxa: '2' }],
    })
    expect(r.ok && r.dados.brandOverrides).toEqual([
      { brand: 'elo', method: 'debit', installments: 1, feePercent: 2 },
    ])
  })
})
