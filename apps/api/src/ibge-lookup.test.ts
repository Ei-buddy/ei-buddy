import { ErroDeIntegracao } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { createBrasilApiIbgeLookup, normalizarCidade } from './ibge-lookup.js'

function fetchFalso(status: number, corpo: unknown) {
  const urls: string[] = []
  const f = (async (url: string) => {
    urls.push(url)
    return new Response(JSON.stringify(corpo), { status })
  }) as unknown as typeof globalThis.fetch
  return { f, urls }
}

const PR = [
  { nome: 'CURITIBA', codigo_ibge: '4106902' },
  { nome: "PEROLA D'OESTE", codigo_ibge: '4119004' },
]

describe('codigo IBGE do municipio — NR-241', () => {
  it('acha pelo nome sem acento nem caixa, e guarda a lista da UF', async () => {
    const { f, urls } = fetchFalso(200, PR)
    const ibge = createBrasilApiIbgeLookup({ fetch: f })
    expect(await ibge.codigoIbge('pr', ' Curitiba ')).toBe('4106902')
    expect(await ibge.codigoIbge('PR', "Pérola d'Oeste")).toBe('4119004')
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/ibge/municipios/v1/PR')
  })

  it('cidade que nao esta na lista e UF invalida voltam sem codigo', async () => {
    const { f, urls } = fetchFalso(200, PR)
    const ibge = createBrasilApiIbgeLookup({ fetch: f })
    expect(await ibge.codigoIbge('PR', 'Cidade Inventada')).toBeUndefined()
    expect(await ibge.codigoIbge('Paraná', 'Curitiba')).toBeUndefined()
    expect(urls).toHaveLength(1)
  })

  it('provedor fora do ar e erro de integracao, nao "cidade nao encontrada"', async () => {
    const { f } = fetchFalso(503, {})
    await expect(
      createBrasilApiIbgeLookup({ fetch: f }).codigoIbge('PR', 'Curitiba'),
    ).rejects.toBeInstanceOf(ErroDeIntegracao)
  })

  it('normaliza como o CEP e o CNPJ escrevem', () => {
    expect(normalizarCidade('São  Paulo')).toBe('SAO PAULO')
    expect(normalizarCidade('MOGI-MIRIM')).toBe('MOGI-MIRIM')
  })
})
