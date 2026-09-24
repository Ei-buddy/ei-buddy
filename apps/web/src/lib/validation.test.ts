import { phoneSchema, pixKeyError } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import {
  maskCelular,
  maskPhone,
  validateCPF,
  validatePixKey,
  type TipoDeChavePix,
} from './validation'

/**
 * As mascaras da tela contra o contrato da api.
 *
 * Existe por um defeito real. O cadastro rapido do PDV usava `maskCelular`,
 * que corta em NOVE digitos — sem DDD —, e o `phoneSchema` exige dez ou onze.
 * Enquanto a chamada era um mock isso nunca aparecia; na primeira chamada de
 * verdade, todo cadastro com celular seria recusado por telefone invalido, e o
 * balcao veria o cadastro inteiro falhar sem entender por que.
 *
 * O teste importa o schema DE VERDADE, e nao uma copia da regra: uma copia
 * empatava com a mascara e continuaria empatando depois de o contrato mudar.
 */

const aceita = (v: string) => phoneSchema.safeParse(v).success

describe('telefone: a mascara da tela e o que a api aceita', () => {
  it('maskPhone com 11 digitos passa no contrato', () => {
    const mascarado = maskPhone('41988887777')

    expect(mascarado).toBe('(41) 98888-7777')
    expect(aceita(mascarado)).toBe(true)
  })

  it('maskPhone com 10 digitos — fixo — tambem passa', () => {
    const mascarado = maskPhone('4133330000')

    expect(mascarado).toBe('(41) 3333-0000')
    expect(aceita(mascarado)).toBe(true)
  })

  /*
   * A guarda do defeito. `maskCelular` e o campo SEM DDD do formulario
   * completo, onde o DDD vem num campo ao lado e os dois sao juntados antes de
   * enviar. Sozinho ele nao serve — e era assim que o PDV o usava.
   */
  it('maskCelular sozinho NAO passa: falta o DDD', () => {
    expect(aceita(maskCelular('988887777'))).toBe(false)
  })

  it('maskCelular com o DDD na frente passa — e o uso correto dele', () => {
    expect(aceita(`41${maskCelular('988887777')}`)).toBe(true)
  })

  it('telefone incompleto e recusado, em vez de gravado torto', () => {
    expect(aceita(maskPhone('4198888'))).toBe(false)
  })
})

describe('CPF', () => {
  it('aceita CPF valido', () => {
    expect(validateCPF('123.456.789-09')).toBeNull()
  })

  it('recusa digito verificador errado', () => {
    expect(validateCPF('123.456.789-00')).not.toBeNull()
  })

  /* Todos os digitos iguais passam na conta do verificador, e nao existem. */
  it('recusa 111.111.111-11, que fecha na conta e nao e CPF', () => {
    expect(validateCPF('111.111.111-11')).not.toBeNull()
  })
})

/* A tela e o contrato decidem igual sobre a chave PIX: uma copia da regra que
   divergisse deixaria passar na etapa 1 o que o servidor recusa na etapa 3. */
describe('chave PIX: a tela e o contrato concordam', () => {
  const casos: [TipoDeChavePix, string][] = [
    ['EMAIL', 'abc'],
    ['EMAIL', 'parceiro@loja.com.br'],
    ['CPF', '123'],
    ['CPF', '529.982.247-25'],
    ['CNPJ', '11222333000100'],
    ['CNPJ', '11.222.333/0001-81'],
    ['PHONE', '12'],
    ['PHONE', '+55 (41) 99876-5432'],
    ['EVP', 'xyz'],
    ['EVP', '123e4567-e89b-12d3-a456-426614174000'],
  ]

  it.each(casos)('%s %s', (tipo, chave) => {
    expect(validatePixKey(chave, tipo) === null).toBe(pixKeyError(chave, tipo) === null)
  })
})
