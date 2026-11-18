import { loginInputSchema, phoneSchema, pixKeyError } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import {
  maskCelular,
  maskPhone,
  validateCPF,
  validateCredential,
  validateDocumentoDoCliente,
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

/**
 * Login por telefone: o que a tela aceita, a api acha — NR-231.
 *
 * Achado de usuaria em teste: criou a conta, saiu, e ao entrar de novo pelo
 * celular formatado recebeu "senha incorreta". A tela aceitava
 * "(41) 99876-5432", mas mandava o texto do jeito que veio, e o cadastro
 * guarda so os digitos. Contra o contrato DE VERDADE, como os testes acima.
 */
describe('login por telefone: a tela e o contrato contam igual', () => {
  const guardadoNoCadastro = (v: string) => phoneSchema.parse(v)
  const comparadoNoLogin = (v: string) =>
    loginInputSchema.parse({ identifier: v, secret: 's' }).identifier

  it.each([
    '(41) 99876-5432',
    '41 99876-5432',
    '41998765432',
    '+55 41 99876-5432',
    '55 (41) 3333-4444',
    '041 99876-5432',
    '(41) 3333-4444',
  ])('"%s": a tela aceita e o login chega no que o cadastro guardou', (digitado) => {
    expect(validateCredential(digitado)).toBeNull()
    const nacional = comparadoNoLogin(digitado)
    expect(nacional).toBe(guardadoNoCadastro(nacional))
    expect(nacional).toMatch(/^\d{10,11}$/)
  })

  it('o celular digitado no cadastro e o digitado no login dao o mesmo valor', () => {
    expect(comparadoNoLogin('(41) 99876-5432')).toBe(guardadoNoCadastro('(41) 99876-5432'))
  })

  it.each(['4199876', '+1 555 123 4567 89', '123'])('"%s" continua recusado na tela', (v) => {
    expect(validateCredential(v)).toBe('Telefone inválido. Use DDD + número.')
  })
})

/**
 * O documento do cliente — DEC-025 revisada em 2026-11-18 (NR-232).
 *
 * Achado de usuaria em teste: na venda pela internet nao da para saber o CPF de
 * todo mundo. Pessoa fisica pode ficar sem; empresa nao, porque o CNPJ e o
 * que faz o cliente ser PJ.
 */
describe('documento do cliente: CPF opcional, CNPJ obrigatorio', () => {
  it('pessoa fisica sem CPF passa', () => {
    expect(validateDocumentoDoCliente('', 'fisica')).toBeNull()
    expect(validateDocumentoDoCliente('   ', 'fisica')).toBeNull()
  })

  it('pessoa juridica sem CNPJ e recusada', () => {
    expect(validateDocumentoDoCliente('', 'juridica')).toBe('Informe o CNPJ.')
  })

  it('CPF digitado continua conferido', () => {
    expect(validateDocumentoDoCliente('529.982.247-25', 'fisica')).toBeNull()
    expect(validateDocumentoDoCliente('529.982.247-26', 'fisica')).toBe('CPF inválido.')
    expect(validateDocumentoDoCliente('529.982', 'fisica')).toBe('CPF incompleto.')
  })
})
