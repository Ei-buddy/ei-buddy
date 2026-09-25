import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrasilApiNcmLookup } from './ncm-lookup.js'

/* O que decide recusar ou deixar passar o cadastro: 404 e "nao existe";
   qualquer outra falha e "indisponivel". */
describe('consulta de NCM na BrasilAPI', () => {
  afterEach(() => vi.unstubAllGlobals())

  const responde = (status: number, corpo?: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(corpo ?? {}), { status })),
    )

  it('existe quando o provedor devolve o mesmo codigo', async () => {
    responde(200, { codigo: '0901.11.10', descricao: 'Cafe nao torrado' })
    await expect(createBrasilApiNcmLookup().consultar('09011110')).resolves.toEqual({
      status: 'existe',
      descricao: 'Cafe nao torrado',
    })
  })

  it('inexistente no 404', async () => {
    responde(404)
    await expect(createBrasilApiNcmLookup().consultar('99999999')).resolves.toEqual({
      status: 'inexistente',
    })
  })

  it('indisponivel no 5xx e na falha de rede — nunca "inexistente"', async () => {
    responde(503)
    await expect(createBrasilApiNcmLookup().consultar('09011110')).resolves.toEqual({
      status: 'indisponivel',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('rede'))),
    )
    await expect(createBrasilApiNcmLookup().consultar('09011110')).resolves.toEqual({
      status: 'indisponivel',
    })
  })
})
