import { randomInt, randomUUID } from 'node:crypto'
import { signupInputSchema } from '@na-regua/contracts'
import { getClient, migrate } from '@na-regua/db'
import Fastify, { type FastifyInstance } from 'fastify'

/* Celular unico por chamada: o cadastro exige e nao aceita repetido. */
function celularDeTeste(): string {
  return `41${randomInt(900_000_000, 999_999_999)}`
}

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerSession } from '../plugins/session.js'
import { registerAdminRoutes } from '../routes/admin.js'
import { registerAuthRoutes } from '../routes/auth.js'
import { registerSuporteRoutes } from '../routes/suporte.js'

/**
 * Chamados vistos pela plataforma, ponta a ponta — NR-215, US-062.
 *
 * Api de verdade, rotas reais, composicao real, Postgres real — o mesmo
 * desenho do `super-admin.test.ts`. O que so aparece na COSTURA:
 *
 * - o chamado que a loja abre pelo `/suporte` aparece na fila do Super Admin
 *   (atravessando a RLS pela funcao `SECURITY DEFINER`, e so por ela);
 * - a resposta da plataforma volta para a loja como mensagem NAO LIDA;
 * - quem nao e Super Admin recebe 403, e sem sessao 401.
 *
 * O Super Admin entra direto no banco, como no bootstrap de producao.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

type Composicao = typeof import('../composition.js')

function cnpjValido(base12: string): string {
  const digito = (nums: number[], pesos: number[]): number => {
    const resto = nums.reduce((acc, n, i) => acc + n * pesos[i]!, 0) % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const base = base12.split('').map(Number)
  const d1 = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digito([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base12}${d1}${d2}`
}

/*
 * `Date.now()` sozinho colide: este arquivo e `caminho-critico.test.ts` os
 * dois semeiam o CNPJ pelo relogio, e varios processos de teste sobem no
 * MESMO milissegundo numa maquina rapida — foi isso que causou um 500
 * intermitente aqui (a segunda insercao em `companies_cnpj_unico` estourava
 * a unicidade, sem ninguem ter digitado o mesmo CNPJ de proposito). Os
 * cinco digitos finais do relogio seguem no lugar (mantem o numero
 * reconhecivelmente falso), e os sete da frente vem de `randomInt` — a parte
 * que garante que dois processos nascidos no mesmo milissegundo nao colidem.
 */
const CNPJ = cnpjValido(`${randomInt(1_000_000, 9_999_999)}${String(Date.now()).slice(-5)}`)

describe.skipIf(!DATABASE_URL)('chamados vistos pela plataforma, ponta a ponta — NR-215', () => {
  let app: FastifyInstance
  let adminToken: string
  let donoToken: string
  let comumToken: string

  const como = (token: string) => ({ authorization: `Bearer ${token}` })

  beforeAll(async () => {
    vi.stubEnv('API_URL', process.env.API_URL ?? 'http://localhost:3333')
    vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET ?? 'segredo-que-o-e2e-nao-usa')
    vi.stubEnv('REDIS_URL', process.env.REDIS_URL ?? 'redis://localhost:6379')

    const composicao: Composicao = await import('../composition.js')
    await migrate(MIGRATION_URL!)

    app = Fastify({ logger: false })
    registerErrorHandler(app)
    await registerRateLimit(app)
    const authDeps = composicao.buildAuthDeps()
    registerSession(app, authDeps.sessions)
    registerAuthRoutes(app, authDeps)
    registerAdminRoutes(app, authDeps)
    registerSuporteRoutes(app, composicao.buildSuporteDeps())
    await app.ready()

    const cadastro = signupInputSchema.parse({
      name: 'Dona do Mercadinho',
      email: `dona-${randomUUID()}@loja.local`,
      phone: celularDeTeste(),
      secret: 'senha-de-teste',
      legalName: 'Mercadinho do Chamado LTDA',
      cnpj: CNPJ,
      acceptedLegalTerms: true,
    })
    const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: cadastro })
    expect(r.statusCode).toBe(201)
    donoToken = r.json().token

    const sql = getClient(DATABASE_URL!)
    const [adm] = await sql<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES ('Gustavo da Plataforma', ${`sa-${randomUUID()}@plataforma.local`})
      RETURNING id
    `
    await sql`INSERT INTO platform_admins (user_id, granted_by) VALUES (${adm!.id}, ${adm!.id})`
    adminToken = await authDeps.sessions.issue(
      { userId: adm!.id, companyId: null },
      new Date(Date.now() + 3_600_000),
    )
    const [com] = await sql<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES ('Sem Poder', ${`co-${randomUUID()}@local`}) RETURNING id
    `
    comumToken = await authDeps.sessions.issue(
      { userId: com!.id, companyId: null },
      new Date(Date.now() + 3_600_000),
    )
  }, 90_000)

  afterAll(async () => {
    await app?.close()
  })

  it('a loja abre, a plataforma ve, responde e encerra; a loja ve a resposta', async () => {
    const aberto = await app.inject({
      method: 'POST',
      url: '/suporte/chamados',
      headers: como(donoToken),
      payload: {
        subject: 'A nota nao sai',
        category: 'tecnico',
        body: 'Tento emitir a NFC-e e aparece um erro.',
      },
    })
    expect(aberto.statusCode).toBe(201)
    const id = aberto.json().id as string

    const fila = await app.inject({
      method: 'GET',
      url: '/admin/chamados?situation=responder&pageSize=100',
      headers: como(adminToken),
    })
    expect(fila.statusCode).toBe(200)
    const item = fila.json().tickets.find((t: { id: string }) => t.id === id)
    expect(item).toMatchObject({
      companyName: 'Mercadinho do Chamado LTDA',
      subject: 'A nota nao sai',
      lastAuthor: 'cliente',
    })
    expect(fila.json().counts.toAnswer).toBeGreaterThanOrEqual(1)

    const resposta = await app.inject({
      method: 'POST',
      url: `/admin/chamados/${id}/respostas`,
      headers: como(adminToken),
      payload: { body: 'Confira o CSC no cadastro da empresa.' },
    })
    expect(resposta.statusCode).toBe(201)
    expect(resposta.json().messages.at(-1)).toMatchObject({
      author: 'suporte',
      authorName: 'Suporte EiBuddy · Gustavo',
    })

    /* A loja ve a resposta como nao lida, no proprio app. */
    const daLoja = await app.inject({
      method: 'GET',
      url: '/suporte/chamados',
      headers: como(donoToken),
    })
    expect(daLoja.json().tickets.find((t: { id: string }) => t.id === id)?.unread).toBe(1)

    const encerrado = await app.inject({
      method: 'POST',
      url: `/admin/chamados/${id}/encerrar`,
      headers: como(adminToken),
    })
    expect(encerrado.statusCode).toBe(200)
    expect(encerrado.json().status).toBe('closed')
  })

  it('quem nao e Super Admin: 403; sem sessao: 401; chamado inexistente: 404', async () => {
    for (const [method, url] of [
      ['GET', '/admin/chamados'],
      ['GET', `/admin/chamados/${randomUUID()}`],
      ['POST', `/admin/chamados/${randomUUID()}/encerrar`],
    ] as const) {
      expect((await app.inject({ method, url, headers: como(comumToken) })).statusCode).toBe(403)
      expect((await app.inject({ method, url, headers: como(donoToken) })).statusCode).toBe(403)
      expect((await app.inject({ method, url })).statusCode).toBe(401)
    }
    const nada = await app.inject({
      method: 'GET',
      url: `/admin/chamados/${randomUUID()}`,
      headers: como(adminToken),
    })
    expect(nada.statusCode).toBe(404)
  })

  it('situacao invalida e resposta vazia: 400', async () => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/admin/chamados?situation=qualquer',
          headers: como(adminToken),
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/admin/chamados/${randomUUID()}/respostas`,
          headers: como(adminToken),
          payload: { body: '   ' },
        })
      ).statusCode,
    ).toBe(400)
  })
})
