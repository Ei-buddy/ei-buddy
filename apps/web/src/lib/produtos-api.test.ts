import { afterEach, describe, expect, it, vi } from 'vitest'
import { atualizarProduto, centavosDaPlanilha, inteiroDaPlanilha } from './produtos-api'

/*
 * Os dois conversores tinham `[^d,.-]` no lugar de `[^\d,.-]`: apagavam TODO
 * digito. Toda planilha importava com preco zero e quantidade vazia, e o
 * formulario de produto — que passou a usar o mesmo conversor — herdaria isso.
 */
describe('centavosDaPlanilha', () => {
  it.each([
    ['12,90', 1290],
    ['12.90', 1290],
    ['R$ 12,90', 1290],
    ['1.234,56', 123456],
    ['1.234', 123400],
    ['10', 1000],
    ['8.5', 850],
  ])('le %s como %i centavos', (texto, centavos) => {
    expect(centavosDaPlanilha(texto)).toBe(centavos)
  })

  it('devolve null, e nao zero, quando nao ha numero', () => {
    expect(centavosDaPlanilha('')).toBeNull()
    expect(centavosDaPlanilha(undefined)).toBeNull()
    expect(centavosDaPlanilha('abc')).toBeNull()
  })
})

describe('inteiroDaPlanilha', () => {
  it('le a quantidade', () => {
    expect(inteiroDaPlanilha('40')).toBe(40)
    expect(inteiroDaPlanilha(' 40 un ')).toBe(40)
  })

  it('devolve null quando nao ha numero', () => {
    expect(inteiroDaPlanilha('')).toBeNull()
  })
})

describe('atualizarProduto', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('envia PATCH parcial com precos em centavos', async () => {
    const espiao = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ ok: true }, { status: 200 }),
    )
    vi.stubGlobal('fetch', espiao)

    const r = await atualizarProduto('p-1', {
      descricao: ' Cafe especial ',
      precoVenda: 29.9,
      precoCusto: 12.5,
    })

    expect(r).toEqual({ ok: true })
    expect(espiao).toHaveBeenCalledOnce()
    const [url, init] = espiao.mock.calls[0]!
    expect(url).toBe('/api/produtos/p-1')
    expect(init).toMatchObject({
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      description: 'Cafe especial',
      salePriceCents: 2990,
      costPriceCents: 1250,
    })
  })

  it('mapeia campos recusados do PATCH', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message: 'Preco invalido',
              fields: [{ path: 'salePriceCents', message: 'Preco de venda menor que o custo' }],
            },
          },
          { status: 400 },
        ),
      ),
    )

    const r = await atualizarProduto('p-1', { precoVenda: 1 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.campos.precoVenda).toBe('Preco de venda menor que o custo')
    expect(r.error).toBe('Preco de venda menor que o custo')
  })
})
