import type { NcmConsulta, NcmLookup } from '@na-regua/core'

/**
 * Tabela de NCM via BrasilAPI — mesmo provedor de CEP e CNPJ, e pela mesma
 * razao: publico, sem chave e sem cota contratada.
 *
 * 404 e "nao existe"; qualquer outra falha (rede, 5xx, demora) e
 * "indisponivel", que o cadastro deixa passar. O tempo limite existe porque o
 * cadastro ESPERA esta resposta: um provedor lento nao pode segurar o balcao.
 *
 * A resposta fica em memoria: a tabela muda por resolucao da Camex, poucas
 * vezes por ano, e uma importacao de planilha repete o mesmo NCM em dezenas de
 * linhas. So "existe" e "inexistente" entram no cache — "indisponivel" e
 * estado do provedor, nao do codigo.
 */
const BASE_URL = 'https://brasilapi.com.br/api/ncm/v1'
const TEMPO_LIMITE_MS = 3000

export function createBrasilApiNcmLookup(): NcmLookup {
  const cache = new Map<string, NcmConsulta>()

  return {
    async consultar(ncm: string): Promise<NcmConsulta> {
      const digitos = ncm.replace(/\D/g, '')
      const guardada = cache.get(digitos)
      if (guardada !== undefined) return guardada

      let resposta: Response
      try {
        resposta = await fetch(`${BASE_URL}/${digitos}`, {
          signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        })
      } catch {
        return { status: 'indisponivel' }
      }

      if (resposta.status === 404) {
        const inexistente: NcmConsulta = { status: 'inexistente' }
        cache.set(digitos, inexistente)
        return inexistente
      }
      if (!resposta.ok) return { status: 'indisponivel' }

      const dados = (await resposta.json().catch(() => undefined)) as
        { codigo?: string; descricao?: string } | undefined

      /* O provedor devolve o codigo com pontos ("0901.11.10"). Conferir que e o
         MESMO codigo evita aceitar uma resposta de outro item da tabela. */
      if (dados?.codigo?.replace(/\D/g, '') !== digitos) return { status: 'indisponivel' }

      const existe: NcmConsulta = { status: 'existe', descricao: dados.descricao?.trim() ?? '' }
      cache.set(digitos, existe)
      return existe
    },
  }
}
