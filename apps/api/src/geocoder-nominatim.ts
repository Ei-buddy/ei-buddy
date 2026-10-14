import type { AddressGeocoder } from '@na-regua/core'
import { motivoDoErro } from './motivo-do-erro.js'
import { USER_AGENT } from './identificacao-do-cliente-http.js'

const BASE_URL = 'https://nominatim.openstreetmap.org/search'

/** Mais que isso e o cadastro esperando o mapa: melhor cair no CEP. */
const TETO_MS = 4_000

type RespostaNominatim = { lat?: string; lon?: string }[]

/**
 * Coordenada pelo endereco completo, no OpenStreetMap (Nominatim) — ADR-0008.
 *
 * Por que este provedor: o CEP (BrasilAPI) devolve, para muitos CEPs, o centro
 * da cidade — duas lojas a 1,6 km apareciam a "0 km" na busca de fornecedor.
 * O Nominatim acha a rua e o numero, e e gratuito.
 *
 * A politica de uso dele pede identificacao (`User-Agent`) e no maximo uma
 * consulta por segundo. Aqui so ha uma consulta por SALVAR o endereco da
 * empresa — muito abaixo disso.
 *
 * Falha (rede, tempo, resposta estranha) nunca trava o cadastro: vira
 * `undefined`, e quem chama cai no CEP, como era antes.
 */
export function createNominatimGeocoder(): AddressGeocoder {
  return {
    async geocode(endereco) {
      const rua = [endereco.street, endereco.number].filter(Boolean).join(', ')
      const parametros = new URLSearchParams({
        format: 'json',
        limit: '1',
        countrycodes: 'br',
        q: `${rua}, ${endereco.city}, ${endereco.state}`,
      })

      try {
        const resposta = await fetch(`${BASE_URL}?${parametros.toString()}`, {
          headers: { 'user-agent': USER_AGENT, 'accept-language': 'pt-BR' },
          signal: AbortSignal.timeout(TETO_MS),
        })
        if (!resposta.ok) return undefined

        const [primeiro] = (await resposta.json()) as RespostaNominatim
        const latitude = Number(primeiro?.lat)
        const longitude = Number(primeiro?.lon)
        /* Lista vazia ou campo ausente vira NaN aqui — e "nao achei". */
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined

        return { latitude, longitude }
      } catch (erro) {
        console.warn(
          JSON.stringify({
            level: 40,
            msg: 'geocodificacao por endereco indisponivel — usando o CEP',
            motivo: motivoDoErro(erro),
          }),
        )
        return undefined
      }
    },
  }
}
