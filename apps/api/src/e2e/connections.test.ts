import { randomInt, randomUUID } from 'node:crypto'
import { signupInputSchema } from '@na-regua/contracts'
import { getClient, migrate } from '@na-regua/db'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerSession } from '../plugins/session.js'
import { registerAuthRoutes } from '../routes/auth.js'
import { registerConnectionsRoutes } from '../routes/connections.js'

/**
 * Conexao entre lojistas por proximidade, ponta a ponta — NR-107, ADR-0008.
 *
 * Mesmo desenho do `super-admin.test.ts`: api de verdade, rotas reais,
 * composicao real, Postgres real. As coordenadas das duas empresas sao
 * gravadas por SQL direto no `beforeAll` — o cadastro por `/auth/signup` nao
 * coleta endereco, e testar a geocodificacao em si e responsabilidade de
 * `packages/core/src/registration/geocoding.test.ts`. Aqui o que importa e o
 * que so aparece na COSTURA: busca cross-tenant, pedido/aceite/recusa por
 * HTTP, e o contato so aparecendo depois do aceite.
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

/** Ver o mesmo comentario em `super-admin.test.ts` sobre por que nao e so `Date.now()`. */
function cnpjDeTeste(): string {
  return cnpjValido(`${randomInt(1_000_000, 9_999_999)}${String(Date.now()).slice(-5)}`)
}

/**
 * Telefone de teste, unico por chamada — `users.phone` tem indice unico.
 *
 * Um literal fixo aqui colide com o USUARIO QUE A EXECUCAO ANTERIOR deste
 * MESMO arquivo deixou no banco de desenvolvimento (nada aqui roda em
 * transacao que desfaz sozinha) — foi o que causou um 500 intermitente em
 * `/auth/signup` toda vez que este arquivo rodava pela segunda vez seguida.
 */
function telefoneDeTeste(): string {
  return `41${randomInt(900_000_000, 999_999_999)}`
}

describe.skipIf(!DATABASE_URL)('conexao entre usuarios, ponta a ponta — ADR-0008', () => {
  let app: FastifyInstance
  let composicao: Composicao
  let empresaAId: string
  let empresaBId: string
  let tokenA: string
  let tokenB: string
  const termo = `zz${randomUUID().replace(/-/g, '').slice(0, 12)}`

  beforeAll(async () => {
    vi.stubEnv('API_URL', process.env.API_URL ?? 'http://localhost:3333')
    vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET ?? 'segredo-que-o-e2e-nao-usa')
    vi.stubEnv('REDIS_URL', process.env.REDIS_URL ?? 'redis://localhost:6379')

    composicao = await import('../composition.js')
    await migrate(MIGRATION_URL!)

    app = Fastify({ logger: false })
    registerErrorHandler(app)
    await registerRateLimit(app)

    const authDeps = composicao.buildAuthDeps()
    registerSession(app, authDeps.sessions)
    registerAuthRoutes(app, authDeps)
    registerConnectionsRoutes(app, composicao.buildConnectionsDeps())

    await app.ready()

    const cadastroA = signupInputSchema.parse({
      name: 'Dona da Loja A',
      email: `dona-a-${randomUUID()}@loja.local`,
      secret: 'senha-de-teste',
      legalName: 'Bolos da Ana LTDA',
      cnpj: cnpjDeTeste(),
      acceptedLegalTerms: true,
      /* Sem telefone, `company_connections_request` recusa por "sem telefone
         cadastrado" — ver a migration 0009. Precisa de um para o pedido a B
         funcionar, e do de B para o pedido A->B funcionar. */
      phone: telefoneDeTeste(),
    })
    const rA = await app.inject({ method: 'POST', url: '/auth/signup', payload: cadastroA })
    expect(rA.statusCode).toBe(201)
    const sessaoA = rA.json()
    empresaAId = sessaoA.activeCompanyId
    tokenA = sessaoA.token

    const cadastroB = signupInputSchema.parse({
      name: 'Dono da Loja B',
      email: `dono-b-${randomUUID()}@loja.local`,
      secret: 'senha-de-teste',
      legalName: 'Distribuidora Farinha Boa LTDA',
      cnpj: cnpjDeTeste(),
      acceptedLegalTerms: true,
      phone: telefoneDeTeste(),
    })
    const rB = await app.inject({ method: 'POST', url: '/auth/signup', payload: cadastroB })
    expect(rB.statusCode).toBe(201)
    const sessaoB = rB.json()
    empresaBId = sessaoB.activeCompanyId
    tokenB = sessaoB.token

    /*
     * Coordenada gravada direto, fora do app — o mesmo espirito do bootstrap
     * de Super Admin. Curitiba (A) e ~1.4km dali (B): perto o bastante para
     * a busca achar, longe o bastante para nao ser a mesma coordenada.
     */
    const sql = getClient(DATABASE_URL!)
    await sql`UPDATE companies SET latitude = -25.4284, longitude = -49.2733 WHERE id = ${empresaAId}`
    await sql`UPDATE companies SET latitude = -25.4400, longitude = -49.2800 WHERE id = ${empresaBId}`
    await sql`
      INSERT INTO products (company_id, description, internal_code, unit_of_measure, sale_price_cents)
      VALUES (${empresaBId}, ${`Farinha de trigo ${termo}`}, ${randomUUID()}, 'un', 1000)
    `
  }, 90_000)

  afterAll(async () => {
    await app?.close()
    if (composicao === undefined) {
      vi.unstubAllEnvs()
      return
    }
    await composicao.shutdown()
    vi.unstubAllEnvs()
  })

  const comToken = (
    token: string,
    opcoes: { method: 'GET' | 'POST'; url: string; payload?: object },
  ) => {
    const base = {
      method: opcoes.method,
      url: opcoes.url,
      headers: { authorization: `Bearer ${token}` },
    }
    return opcoes.payload === undefined
      ? app.inject(base)
      : app.inject({ ...base, payload: opcoes.payload })
  }

  let conexaoId: string

  it('GET /fornecedores acha a empresa B, com distancia', async () => {
    const r = await comToken(tokenA, { method: 'GET', url: `/fornecedores?termo=${termo}` })
    expect(r.statusCode).toBe(200)

    const corpo = r.json() as { results: { companyId: string; distanceKm: number | null }[] }
    expect(corpo.results).toHaveLength(1)
    expect(corpo.results[0]!.companyId).toBe(empresaBId)
    expect(corpo.results[0]!.distanceKm).not.toBeNull()
    expect(corpo.results[0]!.distanceKm!).toBeLessThan(5)
  })

  it('POST /conexoes: A pede conexao com B', async () => {
    const r = await comToken(tokenA, {
      method: 'POST',
      url: '/conexoes',
      payload: { targetCompanyId: empresaBId },
    })

    expect(r.statusCode).toBe(201)
    conexaoId = (r.json() as { id: string }).id
    expect(conexaoId).toBeDefined()
  })

  it('POST /conexoes de novo para a mesma empresa: 409, pedido ja ativo', async () => {
    const r = await comToken(tokenA, {
      method: 'POST',
      url: '/conexoes',
      payload: { targetCompanyId: empresaBId },
    })

    expect(r.statusCode).toBe(409)
  })

  it('GET /conexoes de A mostra o pedido enviado, pendente, sem contato', async () => {
    const r = await comToken(tokenA, { method: 'GET', url: '/conexoes' })
    const corpo = r.json() as {
      connections: { direction: string; status: string; contact: unknown }[]
    }

    expect(corpo.connections).toEqual([
      expect.objectContaining({ direction: 'sent', status: 'pending', contact: null }),
    ])
  })

  it('GET /conexoes/pendentes de B mostra 1 pendente', async () => {
    const r = await comToken(tokenB, { method: 'GET', url: '/conexoes/pendentes' })
    expect(r.json()).toEqual({ count: 1 })
  })

  it('so quem recebeu pode aceitar: A tentando aceitar o proprio pedido da 409', async () => {
    const r = await comToken(tokenA, { method: 'POST', url: `/conexoes/${conexaoId}/aceitar` })
    expect(r.statusCode).toBe(409)
  })

  it('POST /conexoes/:id/aceitar: B aceita, e os dois lados passam a ver o contato', async () => {
    const rAceitar = await comToken(tokenB, {
      method: 'POST',
      url: `/conexoes/${conexaoId}/aceitar`,
    })
    expect(rAceitar.statusCode).toBe(200)

    const rDeA = await comToken(tokenA, { method: 'GET', url: '/conexoes' })
    const conexoesDeA = (rDeA.json() as { connections: { status: string; contact: unknown }[] })
      .connections
    expect(conexoesDeA[0]!.status).toBe('accepted')
    expect(conexoesDeA[0]!.contact).not.toBeNull()

    const rDeB = await comToken(tokenB, { method: 'GET', url: '/conexoes' })
    const conexoesDeB = (rDeB.json() as { connections: { status: string; contact: unknown }[] })
      .connections
    expect(conexoesDeB[0]!.status).toBe('accepted')
    expect(conexoesDeB[0]!.contact).not.toBeNull()
  })

  it('POST /conexoes/:id/encerrar: A desfaz, e o contato some dos dois lados', async () => {
    const r = await comToken(tokenA, { method: 'POST', url: `/conexoes/${conexaoId}/encerrar` })
    expect(r.statusCode).toBe(200)

    const rDeB = await comToken(tokenB, { method: 'GET', url: '/conexoes' })
    const conexoesDeB = (rDeB.json() as { connections: { status: string; contact: unknown }[] })
      .connections
    expect(conexoesDeB[0]!.status).toBe('rejected')
    expect(conexoesDeB[0]!.contact).toBeNull()
  })

  it('GET /fornecedores/sugestoes: sugere quem um par do mesmo ramo ja conectou', async () => {
    const ramo = `Ramo de Teste ${randomUUID()}`
    const sql = getClient(DATABASE_URL!)

    const cadastroPar = signupInputSchema.parse({
      name: 'Dono do Par',
      email: `par-${randomUUID()}@loja.local`,
      secret: 'senha-de-teste',
      legalName: 'Empresa Par do Ramo LTDA',
      cnpj: cnpjDeTeste(),
      acceptedLegalTerms: true,
      phone: telefoneDeTeste(),
    })
    const rPar = await app.inject({ method: 'POST', url: '/auth/signup', payload: cadastroPar })
    const sessaoPar = rPar.json()

    const cadastroBusca = signupInputSchema.parse({
      name: 'Dona que Busca',
      email: `busca-${randomUUID()}@loja.local`,
      secret: 'senha-de-teste',
      legalName: 'Empresa que Busca LTDA',
      cnpj: cnpjDeTeste(),
      acceptedLegalTerms: true,
      phone: telefoneDeTeste(),
    })
    const rBusca = await app.inject({ method: 'POST', url: '/auth/signup', payload: cadastroBusca })
    const sessaoBusca = rBusca.json()

    await sql`UPDATE companies SET business_segment = ${ramo} WHERE id = ${sessaoPar.activeCompanyId}`
    await sql`UPDATE companies SET business_segment = ${ramo} WHERE id = ${sessaoBusca.activeCompanyId}`

    const pedidoDoPar = await comToken(sessaoPar.token, {
      method: 'POST',
      url: '/conexoes',
      payload: { targetCompanyId: empresaBId },
    })
    const { id: conexaoDoPar } = pedidoDoPar.json() as { id: string }
    await comToken(tokenB, { method: 'POST', url: `/conexoes/${conexaoDoPar}/aceitar` })

    const r = await comToken(sessaoBusca.token, { method: 'GET', url: '/fornecedores/sugestoes' })
    expect(r.statusCode).toBe(200)

    const corpo = r.json() as { suggestions: { companyId: string; peerCount: number }[] }
    expect(corpo.suggestions).toEqual([
      expect.objectContaining({ companyId: empresaBId, peerCount: 1 }),
    ])
  })
})
