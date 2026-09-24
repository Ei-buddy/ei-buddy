import type { CepAddress, CepLookup } from '@na-regua/core'
import { motivoDoErro } from './motivo-do-erro.js'

/**
 * Busca de CEP via BrasilAPI — ADR-0008.
 *
 * V2 porque e a unica versao do provedor que devolve coordenada
 * (`location.coordinates`) alem de logradouro/bairro/cidade/UF — a v1 so tem
 * o endereco. Sem chave, sem cota contratada: e um provedor publico, e o
 * comentario em `resolveCoordinates` (core) e o que garante que ficar fora do
 * ar nao trava cadastro nenhum.
 */
const BASE_URL = 'https://brasilapi.com.br/api/cep/v2'

type RespostaBrasilApi = {
  street?: string
  neighborhood?: string
  city?: string
  state?: string
  location?: {
    coordinates?: {
      longitude?: string
      latitude?: string
    }
  }
}

/** String vazia ou nao numerica vira nulo — o provedor devolve `""` quando nao tem a coordenada. */
function paraNumero(valor: string | undefined): number | null {
  if (valor === undefined || valor.trim() === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

export function createBrasilApiCepLookup(): CepLookup {
  return {
    async lookup(cep: string): Promise<CepAddress | undefined> {
      const digitos = cep.replace(/\D/g, '')

      let resposta: Response
      try {
        resposta = await fetch(`${BASE_URL}/${digitos}`)
      } catch (erro) {
        console.warn(
          JSON.stringify({
            level: 40,
            msg: 'busca de CEP indisponivel — endereco/coordenada nao resolvidos desta vez',
            motivo: motivoDoErro(erro),
          }),
        )
        return undefined
      }

      if (!resposta.ok) return undefined

      const dados = (await resposta.json().catch(() => undefined)) as RespostaBrasilApi | undefined
      if (dados === undefined) return undefined

      return {
        street: dados.street ?? null,
        district: dados.neighborhood ?? null,
        city: dados.city ?? null,
        state: dados.state ?? null,
        latitude: paraNumero(dados.location?.coordinates?.latitude),
        longitude: paraNumero(dados.location?.coordinates?.longitude),
      }
    },
  }
}
