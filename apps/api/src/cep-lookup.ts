import type { CepAddress, CepLookup } from '@na-regua/core'
import { motivoDoErro } from './motivo-do-erro.js'
import { USER_AGENT } from './identificacao-do-cliente-http.js'

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
        /* O endpoint de CEP hoje responde sem `user-agent`; o de CNPJ nao.
           Mandar nos dois evita descobrir a diferenca pelo campo que parou
           de preencher. */
        resposta = await fetch(`${BASE_URL}/${digitos}`, {
          headers: { 'user-agent': USER_AGENT },
        })
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

      /*
       * 400 e 404 do provedor sao os dois "confira o numero" — ele responde
       * 400 para digito verificador errado e 404 para numero valido que nao
       * esta cadastrado. QUALQUER outro status e "nao consegui
       * perguntar", e as duas coisas nao podem virar a mesma resposta.
       *
       * Era `return undefined` para tudo, e o caso de uso traduz `undefined`
       * em 404 "confira os numeros" — dizendo ao lojista que o numero esta
       * errado quando o numero estava certo e o provedor e que recusou. Foi
       * assim que um 403 por falta de `user-agent` passou por "CNPJ
       * inexistente" em CNPJ de empresa que qualquer um conhece.
       *
       * Lancar deixa o erro virar 500 com "Algo deu errado do nosso lado.
       * Tente de novo em instantes." — que e a acao certa para quem esta na
       * frente da tela.
       */
      if (resposta.status === 404 || resposta.status === 400) return undefined

      if (!resposta.ok) {
        throw new Error(`a busca de CEP respondeu ${resposta.status} ${resposta.statusText}`)
      }

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
