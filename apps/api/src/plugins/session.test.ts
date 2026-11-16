import type { SubscriptionStatus } from '@na-regua/contracts'
import { assertCanWrite, assertPapelPodeEscrever, type SessionIssuer } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from './error-handler.js'
import { requireContext } from './execution-context.js'
import { registerSession } from './session.js'

/**
 * Loja restrita so le — RF-117, no servidor.
 *
 * O plugin de sessao le a situacao da assinatura nas requisicoes que
 * ESCREVEM e a poe no contexto; quem recusa e `assertCanWrite`, em `core`.
 */

const sessoes: SessionIssuer = {
  issue: async () => 'tok',
  read: async (token: string) =>
    token === 'tok' ? { userId: 'u1', companyId: 'c1', role: 'owner' } : undefined,
  revoke: async () => undefined,
} as unknown as SessionIssuer

let app: FastifyInstance
afterEach(async () => {
  await app?.close()
})

async function montar(status: SubscriptionStatus | null) {
  const consultas: string[] = []
  app = Fastify({ logger: false })
  registerErrorHandler(app)
  registerSession(app, sessoes, async (companyId) => {
    consultas.push(companyId)
    return status
  })
  /* Uma rota de escrita, uma de leitura e uma do que a restrita ainda faz. */
  app.post('/lancar', async (request) => {
    assertCanWrite(requireContext(request))
    return { ok: true }
  })
  app.get('/ler', async (request) => {
    assertPapelPodeEscrever(requireContext(request))
    return { ok: true }
  })
  app.post('/chamado', async (request) => {
    assertPapelPodeEscrever(requireContext(request))
    return { ok: true }
  })
  return consultas
}

const pedir = (method: 'GET' | 'POST', url: string) =>
  app.inject({ method, url, headers: { authorization: 'Bearer tok' } })

describe('loja restrita so le — RF-117', () => {
  it('restrita: lancar e 403 com a mensagem; ler e abrir chamado continuam', async () => {
    await montar('restricted')
    const lancar = await pedir('POST', '/lancar')
    expect(lancar.statusCode).toBe(403)
    expect(lancar.json().error.message).toMatch(/assinatura da loja está restrita/)
    expect((await pedir('GET', '/ler')).statusCode).toBe(200)
    expect((await pedir('POST', '/chamado')).statusCode).toBe(200)
  })

  it('cancelada tambem nao lanca; atrasada e sem assinatura lancam', async () => {
    await montar('cancelled')
    expect((await pedir('POST', '/lancar')).statusCode).toBe(403)
    await app.close()
    await montar('overdue')
    expect((await pedir('POST', '/lancar')).statusCode).toBe(200)
    await app.close()
    await montar(null)
    expect((await pedir('POST', '/lancar')).statusCode).toBe(200)
  })

  it('so consulta a assinatura em quem escreve — leitura nao paga a consulta', async () => {
    const consultas = await montar('active')
    await pedir('GET', '/ler')
    expect(consultas).toEqual([])
    await pedir('POST', '/lancar')
    expect(consultas).toEqual(['c1'])
  })
})
