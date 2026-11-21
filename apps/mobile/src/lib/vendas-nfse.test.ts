import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NfseDaVenda } from './vendas-api'

/* `./api` puxa o armazenamento do aparelho, que nao existe no Node. */
vi.mock('./api', () => ({ chamarApi: vi.fn() }))

const { chamarApi } = await import('./api')
const { cancelarNfse, estadoDaNfse, pedirNfse } = await import('./vendas-api')

/** NFS-e da venda no app — NR-242, a mesma do web. */

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

const chamar = vi.mocked(chamarApi)

beforeEach(() => {
  chamar.mockReset()
})

describe('NFS-e da venda no app — NR-242', () => {
  it('pedir manda POST e devolve a nota processando', async () => {
    chamar.mockResolvedValue({ ok: true, dados: NFSE } as never)
    expect(await pedirNfse('venda 1')).toEqual({ ok: true, nfse: NFSE })
    expect(chamar).toHaveBeenCalledWith('/vendas/venda%201/nfse', { method: 'POST' })
  })

  it('a recusa chega com a mensagem do servidor', async () => {
    chamar.mockResolvedValue({
      ok: false,
      message: 'Informe o Código de Tributação Nacional.',
    } as never)
    expect(await pedirNfse('v1')).toEqual({
      ok: false,
      erro: 'Informe o Código de Tributação Nacional.',
    })
  })

  it('estado: nulo quando nunca pedida; undefined quando a consulta falha', async () => {
    chamar.mockResolvedValueOnce({ ok: true, dados: { serviceInvoice: null } } as never)
    expect(await estadoDaNfse('v1')).toBeNull()
    chamar.mockResolvedValueOnce({ ok: false, message: 'x' } as never)
    expect(await estadoDaNfse('v1')).toBeUndefined()
  })

  it('cancelar manda a justificativa sem espacos nas pontas', async () => {
    chamar.mockResolvedValue({ ok: true, dados: { ...NFSE, status: 'cancelled' } } as never)
    await cancelarNfse('v1', '  Servico lancado em duplicidade  ')
    expect(chamar).toHaveBeenCalledWith('/vendas/v1/nfse/cancelamento', {
      method: 'POST',
      body: { reason: 'Servico lancado em duplicidade' },
    })
  })
})
