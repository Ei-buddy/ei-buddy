import { AppError } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from './error-handler.js'

/**
 * Sobe um Fastify de verdade: o que importa aqui e o par status + corpo que
 * chega ao cliente, e isso so aparece passando pelo ciclo de requisicao.
 * `app.inject` faz isso sem abrir porta.
 */
function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)

  app.get('/nao-encontrado', async () => {
    throw AppError.notFound('Cliente nao encontrado.')
  })
  app.get('/sem-permissao', async () => {
    throw AppError.forbidden()
  })
  app.get('/invalido', async () => {
    throw AppError.validation('Confira os campos indicados e tente de novo.', [
      { path: 'items.0.quantity', message: 'Quantidade minima e 1.' },
    ])
  })
  app.get('/explode', async () => {
    throw new Error('relation "users" does not exist')
  })
  /* Os erros do Postgres como o driver os entrega: `code` e o SQLSTATE. */
  app.get('/id-malformado', async () => {
    throw Object.assign(new Error('invalid input syntax for type uuid: "abc"'), { code: '22P02' })
  })
  app.get('/referencia-inexistente', async () => {
    throw Object.assign(new Error('violates foreign key constraint "receivables_customer_fk"'), {
      code: '23503',
    })
  })

  return app
}

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
})

describe('erro esperado', () => {
  it.each([
    ['/nao-encontrado', 404, 'NOT_FOUND'],
    ['/sem-permissao', 403, 'FORBIDDEN'],
    ['/invalido', 400, 'VALIDATION_FAILED'],
  ])('%s responde %i com o codigo %s', async (url, status, code) => {
    app = buildApp()
    const res = await app.inject({ method: 'GET', url })

    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(code)
  })

  it('leva os campos com problema para a tela destacar', async () => {
    app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/invalido' })

    expect(res.json().error.fields).toEqual([
      { path: 'items.0.quantity', message: 'Quantidade minima e 1.' },
    ])
  })

  it('preserva a mensagem em pt-br destinada ao usuario', async () => {
    app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/nao-encontrado' })

    expect(res.json().error.message).toBe('Cliente nao encontrado.')
  })
})

describe('registro citado que nao existe', () => {
  it('id malformado vira 404, nao 500', async () => {
    app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/id-malformado' })

    expect(res.statusCode).toBe(404)
    expect(JSON.stringify(res.json())).not.toContain('uuid')
  })

  it('chave estrangeira violada vira 404 sem vazar o nome da constraint', async () => {
    app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/referencia-inexistente' })

    expect(res.statusCode).toBe(404)
    expect(JSON.stringify(res.json())).not.toContain('receivables_customer_fk')
  })
})

describe('erro inesperado', () => {
  it('responde 500 sem vazar a mensagem original', async () => {
    app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/explode' })
    const corpo = JSON.stringify(res.json())

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('INTERNAL')
    /* O detalhe do banco fica no log, nunca na resposta — RNF-054. */
    expect(corpo).not.toContain('relation')
    expect(corpo).not.toContain('users')
  })

  it('nao devolve stack em nenhuma hipotese', async () => {
    app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/explode' })

    expect(JSON.stringify(res.json())).not.toContain('at ')
  })
})

describe('formato unico', () => {
  it('rota inexistente usa o mesmo envelope', async () => {
    app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/rota-que-nao-existe' })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
    expect(res.json().error.fields).toEqual([])
  })

  it('toda resposta de erro carrega requestId para correlacionar com o log', async () => {
    app = buildApp()

    for (const url of ['/nao-encontrado', '/explode', '/rota-que-nao-existe']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.json().requestId).toBeTruthy()
    }
  })
})
