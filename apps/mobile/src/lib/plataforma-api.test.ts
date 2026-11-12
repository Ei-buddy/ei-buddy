import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Fila de chamados da plataforma no celular — NR-215. */

vi.mock('./api', () => ({ chamarApi: vi.fn() }))

const { chamarApi } = await import('./api')
const {
  carregarFilaDeChamados,
  contagemDaAba,
  encerrarChamadoDaFila,
  responderChamadoDaFila,
  situacaoDoChamado,
} = await import('./plataforma-api')

describe('fila de chamados', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset()
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: {} } as never)
  })

  it('situacao e contagens, a mesma regra do web', () => {
    expect(situacaoDoChamado({ status: 'waiting', lastAuthor: 'cliente' })).toBe('responder')
    expect(situacaoDoChamado({ status: 'open', lastAuthor: 'suporte' })).toBe('aguardando')
    expect(situacaoDoChamado({ status: 'closed', lastAuthor: 'suporte' })).toBe('encerrados')
    expect(contagemDaAba({ toAnswer: 1, awaitingCustomer: 2, closed: 3 }, 'todos')).toBe(6)
  })

  it('rotas da api', async () => {
    await carregarFilaDeChamados('encerrados')
    await responderChamadoDaFila('c1', '  oi ')
    await encerrarChamadoDaFila('c1')
    expect(vi.mocked(chamarApi).mock.calls).toEqual([
      ['/admin/chamados?situation=encerrados', {}],
      ['/admin/chamados/c1/respostas', { method: 'POST', body: { body: 'oi' } }],
      ['/admin/chamados/c1/encerrar', { method: 'POST' }],
    ])
  })
})
