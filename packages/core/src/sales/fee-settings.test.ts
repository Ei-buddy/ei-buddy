import type { PaymentFeeSettingsInput, Role } from '@na-regua/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import { createDefaultSaleSettings } from './default-settings.js'
import { InMemoryPaymentFeeSettings } from './fee-settings-fake.js'
import {
  comTaxasDaLoja,
  getPaymentFeeSettings,
  savePaymentFeeSettings,
  tabelaDeTarifas,
  TAXAS_PADRAO,
} from './fee-settings.js'
import { InMemoryUnitOfWork } from './fakes.js'
import { registerSale } from './register-sale.js'

/** Taxas de recebimento configuradas pela loja — DEC-027. */

const AGORA = new Date('2026-11-16T13:00:00.000Z')
const EMPRESA = 'emp-1'

const ctx = (role: Role = 'owner'): ExecutionContext => ({
  companyId: EMPRESA,
  userId: 'usr-1',
  role,
  channel: 'app',
  requestId: 'req-1',
  now: AGORA,
})

const DA_LOJA: PaymentFeeSettingsInput = {
  pixFeePercent: 0.99,
  debitFeePercent: 1.49,
  creditFeePercents: [2.99, 4.5, 5.2],
  brandOverrides: [
    { brand: 'elo', method: 'debit', installments: 1, feePercent: 1.99 },
    { brand: 'amex', method: 'credit', installments: 1, feePercent: 3.99 },
  ],
  debitSettlementDays: 1,
  creditSettlementDays: 30,
  anticipation: { enabled: false, monthlyRatePercent: null },
}

describe('a tabela padrao — a mesma de antes da DEC-027', () => {
  it('credito 3% a vista, 5% em 2x, +1,5 ponto por parcela a partir da 3x; debito = a vista; Pix 0', () => {
    const t = tabelaDeTarifas(TAXAS_PADRAO)
    const credito = (n: number) => t.rates.find((r) => r.installments === n)?.feeRatePercent
    expect([credito(1), credito(2), credito(3), credito(12)]).toEqual([3, 5, 6, 19.5])
    expect(t.debitRates).toEqual([{ brand: 'unknown', feeRatePercent: 3 }])
    expect(t.pixFeePercent).toBe(0)
    expect(t.settlementDays).toBe(30)
  })
})

describe('ler e gravar as taxas', () => {
  let repo: InMemoryPaymentFeeSettings
  beforeEach(() => {
    repo = new InMemoryPaymentFeeSettings()
  })

  it('sem configuracao, devolve a padrao marcada como padrao', async () => {
    const r = await getPaymentFeeSettings({ feeSettings: repo }, ctx())
    expect(r.isDefault).toBe(true)
    expect(r.updatedAt).toBeNull()
    expect(r.creditFeePercents[0]).toBe(3)
  })

  it('o responsavel grava; a leitura devolve o que gravou, com a data', async () => {
    const audit = new InMemoryAuditTrail()
    await savePaymentFeeSettings({ feeSettings: repo, audit }, ctx(), DA_LOJA)
    const r = await getPaymentFeeSettings({ feeSettings: repo }, ctx())
    expect(r).toMatchObject({ isDefault: false, pixFeePercent: 0.99, debitSettlementDays: 1 })
    expect(r.updatedAt).toBe(AGORA.toISOString())
  })

  it('funcionario e contador nao alteram taxa', async () => {
    for (const role of ['staff', 'accountant'] as Role[]) {
      const erro = await savePaymentFeeSettings({ feeSettings: repo }, ctx(role), DA_LOJA).catch(
        (e: unknown) => e,
      )
      expect(isAppError(erro) && erro.code, role).toBe('FORBIDDEN')
    }
    expect(repo.porLoja.size).toBe(0)
  })
})

describe('a venda usa as taxas da loja', () => {
  let unitOfWork: InMemoryUnitOfWork
  let repo: InMemoryPaymentFeeSettings
  const PRODUTO = {
    id: 'prod-1',
    description: 'Servico X',
    unitOfMeasure: 'un',
    salePriceCents: 10_000,
    costPriceCents: 4_000,
    stockQuantity: 100,
    taxRate: null,
  }
  const vender = (payment: Record<string, unknown>) =>
    registerSale(
      { unitOfWork, settings: comTaxasDaLoja(createDefaultSaleSettings(), repo) },
      ctx(),
      {
        items: [{ productId: PRODUTO.id, quantity: 1, unitPriceCents: 10_000 }],
        payments: [{ amountCents: 10_000, ...payment } as never],
      },
    )
  const recebivel = () => unitOfWork.vendas.at(-1)!.dados.receivables

  beforeEach(async () => {
    unitOfWork = new InMemoryUnitOfWork(new InMemoryAuditTrail())
    unitOfWork.adicionarProduto(EMPRESA, PRODUTO)
    repo = new InMemoryPaymentFeeSettings()
    await repo.save(EMPRESA, DA_LOJA, 'usr-1', AGORA)
  })

  it('Pix: liquidado na hora, com a taxa descontada do liquido', async () => {
    await vender({ method: 'pix' })
    const [rec] = recebivel()
    expect(rec?.netAmountCents).toBe(10_000 - 99)
    expect(rec?.settledAt).toBe(AGORA.toISOString())
  })

  it('debito: taxa e prazo do debito; bandeira com taxa propria', async () => {
    await vender({ method: 'debit', brand: 'visa' })
    const [visa] = recebivel()
    expect(visa?.netAmountCents).toBe(10_000 - 149)
    expect(visa?.dueDate).toBe('2026-11-17')

    await vender({ method: 'debit', brand: 'elo' })
    expect(recebivel()[0]?.netAmountCents).toBe(10_000 - 199)
  })

  it('credito: taxa por parcelas e a excecao da bandeira', async () => {
    await vender({ method: 'credit', installments: 2, brand: 'visa' })
    const duas = recebivel()
    expect(duas).toHaveLength(2)
    expect(duas.reduce((s, r) => s + r.netAmountCents, 0)).toBe(10_000 - 450)

    await vender({ method: 'credit', installments: 1, brand: 'amex' })
    expect(recebivel()[0]?.netAmountCents).toBe(10_000 - 399)
  })

  it('loja sem configuracao continua com a tabela de antes', async () => {
    repo.porLoja.clear()
    await vender({ method: 'debit', brand: 'visa' })
    expect(recebivel()[0]?.netAmountCents).toBe(10_000 - 300)
    await vender({ method: 'pix' })
    expect(recebivel()[0]?.netAmountCents).toBe(10_000)
  })
})
