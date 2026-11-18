import { loginInputSchema, phoneSchema } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { validateCredential } from './validation'

/**
 * Login por telefone no app: o que a tela aceita, a api acha — NR-231.
 *
 * A mesma conta do web (`apps/web/src/lib/validation.test.ts`), contra o
 * contrato de verdade: a tela aceitava "(41) 99876-5432" e o login, que
 * comparava o texto como veio, dizia "senha incorreta" para quem tinha
 * acabado de criar a conta.
 */
describe('login por telefone: a tela e o contrato contam igual', () => {
  const comparadoNoLogin = (v: string) =>
    loginInputSchema.parse({ identifier: v, secret: 's' }).identifier

  it.each(['(41) 99876-5432', '41 99876-5432', '+55 41 99876-5432', '041 99876-5432'])(
    '"%s": a tela aceita e o login chega no que o cadastro guardou',
    (digitado) => {
      expect(validateCredential(digitado)).toBeNull()
      expect(comparadoNoLogin(digitado)).toBe(phoneSchema.parse('(41) 99876-5432'))
    },
  )

  it.each(['4199876', '123'])('"%s" continua recusado na tela', (v) => {
    expect(validateCredential(v)).toBe('Telefone inválido. Use DDD + número.')
  })

  it('e-mail continua passando', () => {
    expect(validateCredential('ana@loja.com')).toBeNull()
  })
})
