import { randomInt, randomUUID } from 'node:crypto'
import { signupInputSchema } from '@na-regua/contracts'
import { getClient, migrate, withTenant } from '@na-regua/db'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerSession } from '../plugins/session.js'
import { registerAdminRoutes } from '../routes/admin.js'
import { registerAssinaturaRoutes } from '../routes/assinatura.js'
import { registerAuthRoutes } from '../routes/auth.js'

/**
 * A assinatura lida do servidor, ponta a ponta — NR-216, RF-117.
 *
 * Api de verdade, rotas reais, composicao real, Postgres real. O que so
 * aparece na COSTURA:
 *
 * - a loja le a propria situacao por `GET /assinatura` (RLS por empresa), e
 *   `canWrite` segue `podeEscrever`: atrasada ainda escreve, restrita nao;
 * - a plataforma ve a MESMA situacao na lista de empresas, atravessando a
 *   RLS pela funcao `SECURITY DEFINER`.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

type Composicao = typeof import('../composition.js')

function celularDeTeste(): string {
  return `41${randomInt(900_000_000, 999_999_999)}`
}

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

/* Sete digitos aleatorios na frente: dois processos de teste no mesmo
   milissegundo nao colidem na unicidade do CNPJ. */
const CNPJ = cnpjValido(`${randomInt(1_000_000, 9_999_999)}${String(Date.now()).slice(-5)}`)

describe.skipIf(!DATABASE_URL)('assinatura lida do servidor, ponta a ponta — NR-216', () => {
  let app: FastifyInstance
  let donoToken: string
  let adminToken: string
  let empresaId: string

  const como = (token: string) => ({ authorization: `Bearer ${token}` })

  async function gravarAssinatura(status: string, extra: { nextDueDate?: string } = {}) {
    const sql = getClient(DATABASE_URL!)
    await withTenant(
      sql,
      empresaId,
      (tx) => tx`
        INSERT INTO subscriptions (company_id, plan_code, status, next_due_date, restricted_at)
        VALUES (${empresaId}, 'plano-unico', ${status}, ${extra.nextDueDate ?? null},
                ${status === 'restricted' ? new Date('2026-11-10T12:00:00Z') : null})
        ON CONFLICT (company_id) DO UPDATE
          SET status = EXCLUDED.status,
              next_due_date = EXCLUDED.next_due_date,
              restricted_at = EXCLUDED.restricted_at
      `,
    )
  }

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
    registerAssinaturaRoutes(app, composicao.buildAssinaturaDeps())
    await app.ready()

    const cadastro = signupInputSchema.parse({
      name: 'Dono da Loja Atrasada',
      email: `dono-${randomUUID()}@loja.local`,
      phone: celularDeTeste(),
      secret: 'senha-de-teste',
      legalName: 'Loja da Assinatura LTDA',
      cnpj: CNPJ,
      acceptedLegalTerms: true,
    })
    const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: cadastro })
    expect(r.statusCode).toBe(201)
    donoToken = r.json().token
    empresaId = r.json().activeCompanyId
    expect(empresaId).toEqual(expect.any(String))

    const sql = getClient(DATABASE_URL!)
    const [adm] = await sql<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES ('Equipe da Plataforma', ${`sa-${randomUUID()}@plataforma.local`})
      RETURNING id
    `
    await sql`INSERT INTO platform_admins (user_id, granted_by) VALUES (${adm!.id}, ${adm!.id})`
    adminToken = await authDeps.sessions.issue(
      { userId: adm!.id, companyId: null },
      new Date(Date.now() + 3_600_000),
    )
  }, 90_000)

  afterAll(async () => {
    await app?.close()
  })

  it('sem sessao, 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/assinatura' })
    expect(r.statusCode).toBe(401)
  })

  it('loja sem assinatura: situacao nula e PODE lancar', async () => {
    const r = await app.inject({ method: 'GET', url: '/assinatura', headers: como(donoToken) })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ subscription: null, status: null, canWrite: true })
  })

  it('atrasada ainda escreve (tolerancia correndo); restrita nao', async () => {
    await gravarAssinatura('overdue', { nextDueDate: '2026-11-05' })
    const atrasada = await app.inject({
      method: 'GET',
      url: '/assinatura',
      headers: como(donoToken),
    })
    expect(atrasada.statusCode).toBe(200)
    expect(atrasada.json()).toMatchObject({
      status: 'overdue',
      canWrite: true,
      subscription: { planCode: 'plano-unico', nextDueDate: '2026-11-05' },
    })

    await gravarAssinatura('restricted', { nextDueDate: '2026-11-05' })
    const restrita = await app.inject({
      method: 'GET',
      url: '/assinatura',
      headers: como(donoToken),
    })
    expect(restrita.json()).toMatchObject({
      status: 'restricted',
      canWrite: false,
      subscription: { restrictedAt: '2026-11-10T12:00:00.000Z' },
    })
  })

  it('a plataforma ve a mesma situacao na lista de empresas', async () => {
    await gravarAssinatura('restricted', { nextDueDate: '2026-11-05' })
    const r = await app.inject({ method: 'GET', url: '/admin/empresas', headers: como(adminToken) })
    expect(r.statusCode).toBe(200)
    const empresa = (r.json().companies as { id: string }[]).find((c) => c.id === empresaId)
    expect(empresa).toMatchObject({
      subscriptionStatus: 'restricted',
      nextDueDate: '2026-11-05',
      restrictedAt: '2026-11-10T12:00:00.000Z',
    })
  })
})
