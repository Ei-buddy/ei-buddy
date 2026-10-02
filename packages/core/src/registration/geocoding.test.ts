import { describe, expect, it } from 'vitest'
import { InMemoryCepLookup } from './fakes.js'
import { resolveCoordinates } from './geocoding.js'

const ENDERECO_SEM_CEP = { city: 'Curitiba', state: 'PR' as const }
const ENDERECO_COM_CEP = { zipCode: '80010000', city: 'Curitiba', state: 'PR' as const }

describe('resolveCoordinates — ADR-0008', () => {
  it('sem endereco, nao mexe (undefined)', async () => {
    const cepLookup = new InMemoryCepLookup()

    expect(await resolveCoordinates(cepLookup, undefined)).toBeUndefined()
  })

  it('endereco sem CEP, nao mexe (undefined) — nao apaga coordenada anterior', async () => {
    const cepLookup = new InMemoryCepLookup()

    expect(await resolveCoordinates(cepLookup, ENDERECO_SEM_CEP)).toBeUndefined()
  })

  it('CEP com cobertura de coordenada, devolve latitude/longitude', async () => {
    const cepLookup = new InMemoryCepLookup()
    cepLookup.registrar('80010000', {
      street: 'Rua XV de Novembro',
      district: 'Centro',
      city: 'Curitiba',
      state: 'PR',
      latitude: -25.4284,
      longitude: -49.2733,
    })

    expect(await resolveCoordinates(cepLookup, ENDERECO_COM_CEP)).toEqual({
      latitude: -25.4284,
      longitude: -49.2733,
    })
  })

  it('CEP sem cobertura de coordenada, devolve null — limpeza deliberada', async () => {
    const cepLookup = new InMemoryCepLookup()
    cepLookup.registrar('80010000', {
      street: 'Rua XV de Novembro',
      district: 'Centro',
      city: 'Curitiba',
      state: 'PR',
      latitude: null,
      longitude: null,
    })

    expect(await resolveCoordinates(cepLookup, ENDERECO_COM_CEP)).toBeNull()
  })

  it('CEP que o provedor nao conhece, nao mexe (undefined)', async () => {
    const cepLookup = new InMemoryCepLookup()

    expect(await resolveCoordinates(cepLookup, ENDERECO_COM_CEP)).toBeUndefined()
  })

  it('falha do provedor nao trava o cadastro — vira undefined', async () => {
    const cepLookup = new InMemoryCepLookup()
    cepLookup.lookup = async () => {
      throw new Error('Fora do ar (simulado).')
    }

    expect(await resolveCoordinates(cepLookup, ENDERECO_COM_CEP)).toBeUndefined()
  })
})

describe('coordenada pela rua e numero — achado do QA', () => {
  /* O CEP devolve o centro da cidade: lojas vizinhas ficavam a 0 km. */
  const CENTRO = { latitude: -25.4277, longitude: -49.273 }
  const QUADRA = { latitude: -25.4298656, longitude: -49.2672914 }
  const ENDERECO = {
    zipCode: '80010010',
    street: 'Rua XV de Novembro',
    number: '700',
    city: 'Curitiba',
    state: 'PR' as const,
  }
  const comCentro = () => {
    const cep = new InMemoryCepLookup()
    cep.registrar('80010010', {
      street: null,
      district: null,
      city: 'Curitiba',
      state: 'PR',
      ...CENTRO,
    })
    return cep
  }

  it('prefere a posicao do endereco completo', async () => {
    let pedido: unknown
    const geocoder = {
      geocode: async (e: unknown) => {
        pedido = e
        return QUADRA
      },
    }

    expect(await resolveCoordinates(comCentro(), ENDERECO, geocoder)).toEqual(QUADRA)
    expect(pedido).toMatchObject({ street: 'Rua XV de Novembro', number: '700', city: 'Curitiba' })
  })

  it('cai no CEP quando o endereco nao e achado', async () => {
    const geocoder = { geocode: async () => undefined }

    expect(await resolveCoordinates(comCentro(), ENDERECO, geocoder)).toEqual(CENTRO)
  })

  it('cai no CEP quando o servico de mapa falha', async () => {
    const geocoder = {
      geocode: async () => {
        throw new Error('fora do ar')
      },
    }

    expect(await resolveCoordinates(comCentro(), ENDERECO, geocoder)).toEqual(CENTRO)
  })
})
