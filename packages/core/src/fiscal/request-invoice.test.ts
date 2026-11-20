import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type { ItemFiscalDaVenda, VendaParaNota } from '../ports/sale-fiscal.js'
import { requestInvoice } from './request-invoice.js'

/**
 * O gatilho da emissao — NR-042, RF-045, RF-046.
 *
 * O que se guarda aqui e a PRE-CHECAGEM: recusar antes de transmitir, e recusar
 * dizendo qual produto falta. Sem isso, o custo cai na SEFAZ e volta um codigo
 * numerico que ninguem le.
 */

const AGORA = new Date('2026-09-04T12:00:00.000Z')
const EMPRESA = 'empresa-1'

function contexto(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: EMPRESA,
    userId: 'usuario-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...over,
  }
}

const item = (over: Partial<ItemFiscalDaVenda> = {}): ItemFiscalDaVenda => ({
  productId: 'prod-1',
  description: 'Cafe torrado 500g',
  quantity: 1,
  unitPriceCents: 1990,
  unitOfMeasure: 'un',
  ncm: '09011110',
  cfop: '5102',
  taxSituationCode: '102',
  ...over,
})

function cenario(venda: VendaParaNota | undefined) {
  const enfileirados: unknown[] = []
  return {
    enfileirados,
    deps: {
      sales: { forInvoice: async () => venda },
      queue: { enqueue: async (r: unknown) => void enfileirados.push(r) },
    },
  }
}

const vendaValida: VendaParaNota = {
  saleId: 'venda-1',
  items: [item()],
  payments: [{ method: 'cash', amountCents: 1990 }],
  recipient: undefined,
}

async function pegaErro(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}

describe('pedir a nota', () => {
  it('enfileira e responde "na fila", nao "emitida"', async () => {
    const c = cenario(vendaValida)

    const r = await requestInvoice(c.deps, contexto(), { saleId: 'venda-1' })

    /* Dizer "emitida" seria mentir: a SEFAZ ainda nao viu a nota. */
    expect(r.status).toBe('queued')
    expect(c.enfileirados).toHaveLength(1)
  })

  it('monta o pedido com os campos fiscais do produto', async () => {
    const c = cenario(vendaValida)

    await requestInvoice(c.deps, contexto(), { saleId: 'venda-1' })

    expect(c.enfileirados[0]).toMatchObject({
      companyId: EMPRESA,
      saleId: 'venda-1',
      items: [{ ncm: '09011110', cfop: '5102', taxSituationCode: '102' }],
    })
  })

  it('venda de outra empresa responde como inexistente', async () => {
    const c = cenario(undefined)

    const erro = await pegaErro(() => requestInvoice(c.deps, contexto(), { saleId: 'venda-9' }))

    /* 404 e nao 403: confirmar que a venda existe ja e informacao. */
    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})

describe('a pre-checagem — RF-046', () => {
  it('recusa produto sem NCM, e NOMEIA o produto', async () => {
    const c = cenario({
      ...vendaValida,
      items: [item({ description: 'Refrigerante 2L', ncm: null })],
    })

    const erro = await pegaErro(() => requestInvoice(c.deps, contexto(), { saleId: 'venda-1' }))

    /*
     * "Dados fiscais incompletos" manda o lojista abrir um produto por um. O
     * nome manda ele direto ao que falta.
     */
    expect((erro as Error).message).toContain('Refrigerante 2L')
    expect((erro as Error).message).toMatch(/NCM/)
  })

  it('recusa tambem por CFOP e por CST ausentes', async () => {
    for (const faltando of [{ cfop: null }, { taxSituationCode: null }] as const) {
      const c = cenario({ ...vendaValida, items: [item(faltando)] })
      const erro = await pegaErro(() => requestInvoice(c.deps, contexto(), { saleId: 'venda-1' }))
      expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
    }
  })

  it('NADA e enfileirado quando falta classificacao', async () => {
    const c = cenario({ ...vendaValida, items: [item({ ncm: null })] })

    await pegaErro(() => requestInvoice(c.deps, contexto(), { saleId: 'venda-1' }))

    /* Recusar aqui custa nada; recusar na SEFAZ gasta transmissao e entra no
       historico do emitente. */
    expect(c.enfileirados).toHaveLength(0)
  })

  it('corta a lista em tres nomes e diz quantos faltam', async () => {
    const c = cenario({
      ...vendaValida,
      items: ['A', 'B', 'C', 'D', 'E'].map((n) => item({ description: n, ncm: null })),
    })

    const erro = await pegaErro(() => requestInvoice(c.deps, contexto(), { saleId: 'venda-1' }))

    /* Uma venda de trinta itens sem classificacao viraria um paragrafo que
       ninguem le, e o primeiro produto ja basta para entender o que fazer. */
    expect((erro as Error).message).toContain('e mais 2')
    expect((erro as Error).message).not.toContain('D')
  })

  it('venda sem item nao vira nota', async () => {
    const c = cenario({ ...vendaValida, items: [] })

    const erro = await pegaErro(() => requestInvoice(c.deps, contexto(), { saleId: 'venda-1' }))

    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
  })
})

describe('quem pode', () => {
  it('o contador nao emite nota', async () => {
    const c = cenario(vendaValida)

    const erro = await pegaErro(() =>
      requestInvoice(c.deps, contexto({ role: 'accountant' }), { saleId: 'venda-1' }),
    )

    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })
})

describe('servico fica fora da NFC-e — NR-241', () => {
  const corte = item({
    productId: 'prod-corte',
    description: 'Corte de cabelo',
    unitPriceCents: 6000,
    ncm: null,
    cfop: null,
    taxSituationCode: null,
    nbsCode: '101011000',
  })

  it('leva so a mercadoria, e servico sem NCM nao trava a nota', async () => {
    const c = cenario({
      ...vendaValida,
      items: [item({ unitPriceCents: 4000 }), corte],
      payments: [{ method: 'pix', amountCents: 10000 }],
    })

    await requestInvoice(c.deps, contexto(), { saleId: 'venda-1' })

    const pedido = c.enfileirados[0] as { items: { description: string }[]; payments: unknown[] }
    expect(pedido.items.map((i) => i.description)).toEqual(['Cafe torrado 500g'])
    /* So a parte da mercadoria: 40% de R$ 100,00. */
    expect(pedido.payments).toEqual([{ method: 'pix', amountCents: 4000 }])
  })

  it('venda so de servico manda emitir a NFS-e', async () => {
    const c = cenario({ ...vendaValida, items: [corte] })
    const erro = await pegaErro(() => requestInvoice(c.deps, contexto(), { saleId: 'venda-1' }))
    expect(isAppError(erro) && erro.message).toMatch(/emita a NFS-e/)
    expect(c.enfileirados).toHaveLength(0)
  })
})

describe('pagamentos da parte da venda — NR-241', () => {
  it('divide na proporcao e a soma fecha no centavo', async () => {
    const { pagamentosDaParte } = await import('./request-invoice.js')
    const r = pagamentosDaParte(
      [
        { method: 'cash', amountCents: 3333 },
        { method: 'pix', amountCents: 3334 },
      ],
      1,
      3,
    )
    expect(r.reduce((s, p) => s + p.amountCents, 0)).toBe(Math.round(6667 / 3))
    expect(r.map((p) => p.method)).toEqual(['cash', 'pix'])
  })

  it('sem servico na venda, os pagamentos voltam intactos', async () => {
    const { pagamentosDaParte } = await import('./request-invoice.js')
    const pagamentos = [{ method: 'cash', amountCents: 1990 }]
    expect(pagamentosDaParte(pagamentos, 1990, 1990)).toEqual(pagamentos)
  })
})
