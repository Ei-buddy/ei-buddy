import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  carregarFila,
  contagemDaAba,
  encerrarChamado,
  responderChamado,
  situacaoDoChamado,
} from './admin-chamados-api'

/** Fila de chamados da plataforma — NR-215. */

describe('situacao e contagens', () => {
  it('a situacao sai de quem falou por ultimo; encerrado e encerrado', () => {
    expect(situacaoDoChamado({ status: 'waiting', lastAuthor: 'cliente' })).toBe('responder')
    expect(situacaoDoChamado({ status: 'open', lastAuthor: 'suporte' })).toBe('aguardando')
    expect(situacaoDoChamado({ status: 'closed', lastAuthor: 'cliente' })).toBe('encerrados')
    expect(situacaoDoChamado({ status: 'open', lastAuthor: null })).toBe('responder')
  })

  it('Todos e a soma das tres', () => {
    const c = { toAnswer: 2, awaitingCustomer: 3, closed: 5 }
    expect(contagemDaAba(c, 'responder')).toBe(2)
    expect(contagemDaAba(c, 'aguardando')).toBe(3)
    expect(contagemDaAba(c, 'encerrados')).toBe(5)
    expect(contagemDaAba(c, 'todos')).toBe(10)
  })
})

describe('chamadas ao BFF', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fila, resposta e encerramento vao para as rotas certas', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({}))
    vi.stubGlobal('fetch', fetch)
    await carregarFila('aguardando', 2)
    await responderChamado('ch/1', '  Oi  ')
    await encerrarChamado('ch-2')
    expect(fetch.mock.calls.map((c) => [c[0], c[1]?.method ?? 'GET'])).toEqual([
      ['/api/admin/chamados?situation=aguardando&page=2', 'GET'],
      ['/api/admin/chamados/ch%2F1/respostas', 'POST'],
      ['/api/admin/chamados/ch-2/encerrar', 'POST'],
    ])
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ body: 'Oi' })
  })
})
