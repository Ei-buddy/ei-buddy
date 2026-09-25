import { AppError } from '../app-error.js'
import type { CepAddress, CepLookup } from '../ports/cep-lookup.js'
import type { CnpjCompany, CnpjLookup } from '../ports/cnpj-lookup.js'

/**
 * As duas consultas que preenchem formulario: CEP e CNPJ.
 *
 * Elas ficam aqui, e nao na rota, porque o "so digitos, tamanho exato" e a
 * unica regra que existe — e regra repetida em duas rotas e regra que diverge.
 * O adapter recebe digitos limpos e nao precisa se defender de mascara.
 *
 * NAO ha `ExecutionContext` nestas duas funcoes: consultar um CEP nao le nem
 * escreve nada da empresa. A autenticacao continua sendo exigida na rota (e o
 * que impede alguem de usar nossa cota de terceiro de graca), mas o caso de
 * uso nao tem o que fazer com um tenant.
 *
 * ## Por que 404 e nao resultado vazio
 *
 * "CEP nao existe" e a resposta certa para uma pergunta, nao um erro do
 * sistema — mas a tela precisa distinguir isso de "o provedor caiu", e as duas
 * coisas viriam como `undefined` da porta. `NOT_FOUND` separa: 404 o lojista
 * corrige digitando de novo; 5xx ele tenta mais tarde.
 */

export type LookupCepDeps = {
  readonly cepLookup: CepLookup
}

export async function lookupAddressByCep(deps: LookupCepDeps, cep: string): Promise<CepAddress> {
  const digitos = cep.replace(/\D/g, '')

  if (digitos.length !== 8) {
    throw AppError.validation('Informe o CEP completo, com oito digitos.', [
      { path: 'cep', message: 'CEP incompleto.' },
    ])
  }

  const encontrado = await deps.cepLookup.lookup(digitos)

  if (encontrado === undefined) {
    throw AppError.notFound('Nao encontramos esse CEP. Confira os numeros.')
  }

  return encontrado
}

export type LookupCnpjDeps = {
  readonly cnpjLookup: CnpjLookup
}

export async function lookupCompanyByCnpj(
  deps: LookupCnpjDeps,
  cnpj: string,
): Promise<CnpjCompany> {
  const digitos = cnpj.replace(/\D/g, '')

  if (digitos.length !== 14) {
    throw AppError.validation('Informe o CNPJ completo, com quatorze digitos.', [
      { path: 'documento', message: 'CNPJ incompleto.' },
    ])
  }

  const encontrado = await deps.cnpjLookup.lookup(digitos)

  if (encontrado === undefined) {
    throw AppError.notFound('Nao encontramos esse CNPJ na Receita. Confira os numeros.')
  }

  return encontrado
}
