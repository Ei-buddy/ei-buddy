import type { InvoiceIssueResult } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '../context.js'
import { cancelSaleInvoice } from './cancel-invoice.js'

const AGORA = new Date('2026-10-05T12:00:00.000Z')
const ctx: ExecutionContext = {
  companyId: 'emp-1',
  userId: 'user-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: AGORA,
}
const CHAVE = '4'.repeat(44)

const autorizada = (minutosAtras: number): InvoiceIssueResult => ({
  status: 'authorized',
  accessKey: CHAVE,
  number: 1,
  series: 1,
  xml: '<nfe/>',
  issuedAt: new Date(AGORA.getTime() - minutosAtras * 60_000).toISOString(),
  danfeUrl: 'https://danfe',
})

function cenario(nota: InvoiceIssueResult | undefined, sefazRecusa = false) {
  const feito = { cancelados: [] as string[], trilha: 0 }
  const deps = {
    store: { findBySale: async () => (nota === undefined ? undefined : { resultado: nota }) },
    invoices: {
      cancel: async (r: { accessKey: string }) => {
        if (sefazRecusa) {
          return {
            status: 'rejected' as const,
            rejection: { code: '501', message: 'Prazo expirado' },
          }
        }
        feito.cancelados.push(r.accessKey)
        return {
          status: 'cancelled' as const,
          accessKey: r.accessKey,
          protocol: 'P-1',
          xml: '<ev/>',
          cancelledAt: AGORA.toISOString(),
        }
      },
    },
    audit: { record: async () => void (feito.trilha += 1) as never },
  }
  return { deps, feito }
}

const pedido = { saleId: 'v-1', reason: 'Cliente desistiu da compra no caixa' }

describe('cancelar a nota da venda — RF-050, RF-051', () => {
  it('cancela dentro do prazo e registra na trilha', async () => {
    const c = cenario(autorizada(10))
    const r = await cancelSaleInvoice(c.deps, ctx, pedido)

    expect(r.protocol).toBe('P-1')
    expect(c.feito).toEqual({ cancelados: [CHAVE], trilha: 1 })
  })

  it('fora do prazo recusa sem transmitir', async () => {
    const c = cenario(autorizada(31))
    await expect(cancelSaleInvoice(c.deps, ctx, pedido)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(c.feito.cancelados).toEqual([])
  })

  it('sem nota, ou nota em contingencia, nao cancela', async () => {
    await expect(cancelSaleInvoice(cenario(undefined).deps, ctx, pedido)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const contingencia = { ...autorizada(5), status: 'contingency', reason: 'offline' } as never
    await expect(cancelSaleInvoice(cenario(contingencia).deps, ctx, pedido)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  it('a recusa da SEFAZ volta com a frase dela', async () => {
    const c = cenario(autorizada(5), true)
    await expect(cancelSaleInvoice(c.deps, ctx, pedido)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Prazo expirado',
    })
  })
})
