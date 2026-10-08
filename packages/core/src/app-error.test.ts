import { describe, expect, it } from 'vitest'
import { AppError, isAppError } from './app-error.js'

describe('AppError', () => {
  it('guarda o codigo separado da mensagem', () => {
    const erro = new AppError('CONFLICT', 'Este e-mail ja esta cadastrado.')

    expect(erro.code).toBe('CONFLICT')
    expect(erro.message).toBe('Este e-mail ja esta cadastrado.')
    expect(erro.name).toBe('AppError')
  })

  it('e um Error de verdade — stack e instanceof funcionam', () => {
    const erro = AppError.notFound()

    expect(erro).toBeInstanceOf(Error)
    expect(erro.stack).toBeTruthy()
  })

  it('vem sem campos por padrao', () => {
    expect(AppError.forbidden().fields).toEqual([])
  })

  it('carrega os campos quando a validacao os fornece', () => {
    const erro = AppError.validation('Confira os campos.', [
      { path: 'items.0.quantity', message: 'Quantidade minima e 1.' },
    ])

    expect(erro.code).toBe('VALIDATION_FAILED')
    expect(erro.fields).toHaveLength(1)
    expect(erro.fields[0]?.path).toBe('items.0.quantity')
  })
})

/**
 * As mensagens padrao vao direto para a tela (RNF-054): dizem o que aconteceu
 * e o que fazer, sem jargao nem codigo cru. O teste guarda isso — trocar uma
 * delas por "Forbidden" passaria despercebido sem ele.
 */
describe('mensagens padrao', () => {
  it.each([
    [AppError.notFound(), 'NOT_FOUND'],
    [AppError.forbidden(), 'FORBIDDEN'],
    [AppError.unauthorized(), 'UNAUTHORIZED'],
  ])('%#: mensagem em pt-br sem jargao', (erro, code) => {
    expect(erro.code).toBe(code)
    expect(erro.message.length).toBeGreaterThan(10)
    expect(erro.message).not.toMatch(/error|forbidden|unauthorized|not found/i)
  })

  it('aceita mensagem propria no lugar da padrao', () => {
    expect(AppError.notFound('Cliente não encontrado.').message).toBe('Cliente não encontrado.')
  })

  /* `conflict` nao tem padrao: o que conflita muda caso a caso. */
  it('conflict exige mensagem propria', () => {
    const erro = AppError.conflict('Esta venda ja foi cancelada.')

    expect(erro.code).toBe('CONFLICT')
    expect(erro.message).toBe('Esta venda ja foi cancelada.')
  })
})

describe('isAppError', () => {
  it('reconhece AppError', () => {
    expect(isAppError(AppError.notFound())).toBe(true)
  })

  it.each([
    [new Error('qualquer'), 'Error comum'],
    [new TypeError('tipo'), 'TypeError'],
    ['string', 'string solta'],
    [null, 'null'],
    [undefined, 'undefined'],
    [{ code: 'NOT_FOUND' }, 'objeto que so parece'],
  ])('recusa %s (%s)', (valor, _motivo) => {
    expect(isAppError(valor)).toBe(false)
  })
})
