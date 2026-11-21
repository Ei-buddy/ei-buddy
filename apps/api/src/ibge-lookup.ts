import { ErroDeIntegracao } from '@na-regua/contracts'
import type { CityCodeLookup } from '@na-regua/core'
import { USER_AGENT } from './identificacao-do-cliente-http.js'
import { motivoDoErro } from './motivo-do-erro.js'

/**
 * Codigo IBGE do municipio pelo nome e UF — NR-241.
 *
 * A NFS-e nacional identifica o municipio pelo codigo IBGE de 7 digitos, e o
 * cadastro da loja so tem o nome da cidade. A BrasilAPI lista os municipios de
 * cada UF com o codigo; procura-se o nome sem acento e sem caixa, como o CEP e
 * o CNPJ costumam devolver ("SAO PAULO", "São Paulo").
 *
 * A lista de cada UF fica em memoria: muda por lei de criacao de municipio,
 * nao de uma consulta para outra, e o caso de uso guarda o codigo na empresa
 * depois da primeira vez.
 */

const BASE_URL = 'https://brasilapi.com.br/api/ibge/municipios/v1'

type Municipio = { nome?: string; codigo_ibge?: string | number }

/** "São Paulo", "SAO PAULO", " sao  paulo " → "SAO PAULO". */
export function normalizarCidade(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

export function createBrasilApiIbgeLookup(
  opcoes: { readonly fetch?: typeof globalThis.fetch } = {},
): CityCodeLookup {
  const buscar = opcoes.fetch ?? globalThis.fetch
  const porUf = new Map<string, Map<string, string>>()

  async function municipiosDe(uf: string): Promise<Map<string, string>> {
    const guardado = porUf.get(uf)
    if (guardado !== undefined) return guardado

    const url = `${BASE_URL}/${encodeURIComponent(uf)}?providers=dados-abertos-br,gov,wikipedia`
    let resposta: Response
    try {
      resposta = await buscar(url, { headers: { 'user-agent': USER_AGENT } })
    } catch (erro) {
      throw new ErroDeIntegracao(`a lista de municipios nao respondeu: ${motivoDoErro(erro)}`, {
        provedor: 'brasilapi',
        operacao: `GET ${url}`,
        status: 0,
      })
    }

    /* UF que nao existe: a lista e vazia, e a cidade "nao foi encontrada". */
    if (resposta.status === 404 || resposta.status === 400) return new Map()
    if (!resposta.ok) {
      throw new ErroDeIntegracao(`a lista de municipios respondeu ${resposta.status}`, {
        provedor: 'brasilapi',
        operacao: `GET ${url}`,
        status: resposta.status,
      })
    }

    const lista = (await resposta.json().catch(() => [])) as Municipio[]
    const mapa = new Map<string, string>()
    for (const m of Array.isArray(lista) ? lista : []) {
      const codigo = String(m.codigo_ibge ?? '').replace(/\D/g, '')
      if (m.nome !== undefined && codigo.length === 7) mapa.set(normalizarCidade(m.nome), codigo)
    }
    if (mapa.size > 0) porUf.set(uf, mapa)
    return mapa
  }

  return {
    async codigoIbge(uf, cidade) {
      const sigla = uf.trim().toUpperCase()
      if (!/^[A-Z]{2}$/.test(sigla)) return undefined
      return (await municipiosDe(sigla)).get(normalizarCidade(cidade))
    },
  }
}
