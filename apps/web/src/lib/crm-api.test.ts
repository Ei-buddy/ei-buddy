import { afterEach, describe, expect, it, vi } from 'vitest'
import { excluirCard } from './crm-api'

/** Excluir card do CRM — NR-213. */

describe('excluirCard', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('manda DELETE ao BFF e aceita o 204 sem corpo', async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }),
    )
    vi.stubGlobal('fetch', fetch)
    expect(await excluirCard('card-1')).toEqual({ ok: true, dados: null })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/crm/cards/card-1')
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('DELETE')
  })

  it('404 vira a mensagem do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: { message: 'Card não encontrado.' } }, { status: 404 }),
      ),
    )
    expect(await excluirCard('x')).toEqual({ ok: false, erro: 'Card não encontrado.' })
  })
})
