import { describe, expect, it } from 'vitest'
import { motivoDoErro } from './motivo-do-erro.js'

describe('motivo do erro — NR-015', () => {
  it('usa a mensagem quando ha uma', () => {
    expect(motivoDoErro(new Error('conexao recusada'))).toBe('conexao recusada')
  })

  /*
   * O caso que motivou o helper: o ioredis lanca `AggregateError` de mensagem
   * VAZIA quando nao conecta, e tres avisos do sistema imprimiam `motivo: ""`
   * justamente quando alguem precisava do motivo.
   */
  it('desce no AggregateError, que tem mensagem vazia', () => {
    const erro = new AggregateError(
      [
        new Error('connect ECONNREFUSED ::1:6379'),
        new Error('connect ECONNREFUSED 127.0.0.1:6379'),
      ],
      '',
    )

    expect(motivoDoErro(erro)).toBe(
      'connect ECONNREFUSED ::1:6379; connect ECONNREFUSED 127.0.0.1:6379',
    )
  })

  /* IPv6 e IPv4 costumam dizer a mesma coisa; repetir cansa sem informar. */
  it('nao repete motivos iguais', () => {
    const erro = new AggregateError([new Error('recusado'), new Error('recusado')], '')

    expect(motivoDoErro(erro)).toBe('recusado')
  })

  it('cai no nome quando nao ha mensagem nem agregados', () => {
    expect(motivoDoErro(new AggregateError([], ''))).toBe('AggregateError')
  })

  it('aceita o que nao e Error', () => {
    expect(motivoDoErro('quebrou')).toBe('quebrou')
  })
})
