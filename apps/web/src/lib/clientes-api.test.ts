import { camposFaltandoNoCliente as doContrato } from '@na-regua/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { camposFaltandoNoCliente, listarClientes, resumoDeClientes } from './clientes-api'

/* A copia do web contra o contrato de verdade (DEC-025): se um mudar e o
   outro nao, o aviso de cadastro incompleto da tela mente. */
describe('cadastro incompleto: a copia do web e o contrato', () => {
  const COMPLETO = {
    document: '52998224725',
    phone: '41988887777',
    address: {
      zipCode: '80010000',
      street: 'Rua XV',
      number: '100',
      district: 'Centro',
      city: 'Curitiba',
      state: 'PR',
    },
  }
  const VAZIO = {
    zipCode: null,
    street: null,
    number: null,
    district: null,
    city: null,
    state: null,
  }

  it.each([
    ['completo', COMPLETO],
    ['cliente antigo so com nome', { document: null, phone: null, address: VAZIO }],
    ['sem documento', { ...COMPLETO, document: null }],
    ['sem bairro', { ...COMPLETO, address: { ...COMPLETO.address, district: '  ' } }],
    ['sem celular', { ...COMPLETO, phone: null }],
  ])('%s', (_caso, cliente) => {
    expect(camposFaltandoNoCliente(cliente)).toEqual(doContrato(cliente))
  })
})

describe('resumo do topo — NR-211', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('pede a loja inteira e traduz para reais', async () => {
    const fetch = vi.fn(async (_url: string) =>
      Response.json({ total: 30, withBalance: { count: 4, balanceCents: 12_345 }, inactive: 9 }),
    )
    vi.stubGlobal('fetch', fetch)
    expect(await resumoDeClientes()).toEqual({
      ok: true,
      dados: { total: 30, comPendencia: 4, totalPendente: 123.45, semComprar: 9 },
    })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/clientes/resumo')
  })

  it('a lista pede a pagina certa', async () => {
    const fetch = vi.fn(async (_url: string) =>
      Response.json({ customers: [], total: 50, page: 3, pageSize: 24 }),
    )
    vi.stubGlobal('fetch', fetch)
    const r = await listarClientes({ termo: '', filtro: 'inativos', pagina: 3 })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/clientes?filter=inativos&page=3')
    expect(r.ok && r.dados.porPagina).toBe(24)
  })
})
