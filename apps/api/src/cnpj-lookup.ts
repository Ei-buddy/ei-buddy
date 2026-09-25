import type { CnpjCompany, CnpjLookup } from '@na-regua/core'
import { motivoDoErro } from './motivo-do-erro.js'
import { USER_AGENT } from './identificacao-do-cliente-http.js'

/**
 * Consulta de CNPJ via BrasilAPI.
 *
 * Mesmo provedor da busca de CEP (`cep-lookup.ts`), e de proposito: um
 * fornecedor a menos para monitorar, e a mesma decisao ja tomada la vale aqui
 * — publico, sem chave e sem cota contratada.
 *
 * A BrasilAPI e uma fachada sobre a base publica da Receita. O `numero` vem em
 * texto porque endereco tem "S/N" e "482-A"; converter para numero perderia os
 * dois casos.
 */
const BASE_URL = 'https://brasilapi.com.br/api/cnpj/v1'

type RespostaBrasilApi = {
  razao_social?: string
  nome_fantasia?: string
  cnae_fiscal_descricao?: string
  cep?: string
  logradouro?: string
  numero?: string
  bairro?: string
  municipio?: string
  uf?: string
  descricao_situacao_cadastral?: string
}

/** Texto vazio vira nulo — o provedor devolve `""` no lugar do campo ausente. */
function ouNulo(valor: string | undefined): string | null {
  if (valor === undefined) return null
  const limpo = valor.trim()
  return limpo === '' ? null : limpo
}

export function createBrasilApiCnpjLookup(): CnpjLookup {
  return {
    async lookup(cnpj: string): Promise<CnpjCompany | undefined> {
      const digitos = cnpj.replace(/\D/g, '')

      let resposta: Response
      try {
        resposta = await fetch(`${BASE_URL}/${digitos}`, {
          headers: { 'user-agent': USER_AGENT },
        })
      } catch (erro) {
        console.warn(
          JSON.stringify({
            level: 40,
            msg: 'consulta de CNPJ indisponivel — o lojista preenche a mao desta vez',
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
        throw new Error(`a consulta de CNPJ respondeu ${resposta.status} ${resposta.statusText}`)
      }

      const dados = (await resposta.json().catch(() => undefined)) as RespostaBrasilApi | undefined

      /*
       * Sem razao social nao ha o que sugerir. O provedor responde 200 com
       * corpo de erro em alguns casos (CNPJ com digito verificador errado), e
       * devolver um formulario preenchido com nulos seria pior que dizer que
       * nao achou.
       */
      const razaoSocial = ouNulo(dados?.razao_social)
      if (razaoSocial === null) return undefined

      return {
        legalName: razaoSocial,
        tradeName: ouNulo(dados?.nome_fantasia),
        mainActivity: ouNulo(dados?.cnae_fiscal_descricao),
        zipCode: ouNulo(dados?.cep)?.replace(/\D/g, '') ?? null,
        street: ouNulo(dados?.logradouro),
        streetNumber: ouNulo(dados?.numero),
        district: ouNulo(dados?.bairro),
        city: ouNulo(dados?.municipio),
        state: ouNulo(dados?.uf),
        registrationStatus: ouNulo(dados?.descricao_situacao_cadastral),
      }
    },
  }
}
