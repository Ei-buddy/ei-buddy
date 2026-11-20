import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelarNfse, estadoDaNfse, pedirNfse, type NfseDaVenda } from './vendas-api'

/** NFS-e da venda pela tela — NR-242. */

const NFSE: NfseDaVenda = {
  status: 'processing',
  amountCents: 6000,
  discountCents: 0,
  description: '1x Corte',
  number: null,
  accessKey: null,
  danfseUrl: null,
  publicUrl: null,
  rejection: null,
  requestedAt: '2026-11-20T23:30:00.000Z',
  issuedAt: null,
  cancelledAt: null,
}

function responde(status: number, corpo: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(corpo), { status }))
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NFS-e da venda — NR-242', () => {
  it('pedir manda POST para a venda e devolve a nota processando', async () => {
    const f = responde(202, NFSE)
    expect(await pedirNfse('venda 1')).toEqual({ ok: true, nfse: NFSE })
    expect(f).toHaveBeenCalledWith(
      '/api/vendas/venda%201/nfse',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('a recusa chega com a mensagem que diz onde corrigir', async () => {
    responde(400, {
      error: {
        message: 'Para emitir a NFS-e, informe o Código de Tributação Nacional em Empresa.',
      },
    })
    expect(await pedirNfse('v1')).toEqual({
      ok: false,
      error: 'Para emitir a NFS-e, informe o Código de Tributação Nacional em Empresa.',
    })
  })

  it('estado: nulo quando nunca pedida; undefined quando a consulta falha', async () => {
    responde(200, { serviceInvoice: null })
    expect(await estadoDaNfse('v1')).toBeNull()
    responde(200, { serviceInvoice: NFSE })
    expect(await estadoDaNfse('v1')).toEqual(NFSE)
    responde(500, { error: { message: 'x' } })
    expect(await estadoDaNfse('v1')).toBeUndefined()
  })

  it('cancelar manda a justificativa sem espacos nas pontas', async () => {
    const f = responde(200, { ...NFSE, status: 'cancelled' })
    const r = await cancelarNfse('v1', '  Servico lancado em duplicidade  ')
    expect(r.ok).toBe(true)
    const init = f.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'Servico lancado em duplicidade' })
  })
})
