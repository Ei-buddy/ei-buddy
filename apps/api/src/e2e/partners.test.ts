import { randomInt, randomUUID } from 'node:crypto'
import { signupInputSchema } from '@na-regua/contracts'
import { getClient, migrate } from '@na-regua/db'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerSession } from '../plugins/session.js'
import { registerAdminRoutes } from '../routes/admin.js'
import { registerAuthRoutes } from '../routes/auth.js'
import { registerPartnersRoutes } from '../routes/partners.js'

/**
 * Conta de Parceiro, ponta a ponta — NR-115, ADR-0013.
 *
 * Mesmo desenho de `super-admin.test.ts`: api de verdade, rotas reais,
 * composicao real, Postgres real. O que se prova aqui e a costura completa:
 * cadastro com `account.type: 'parceiro'` -> candidatura pending -> painel
 * do Super Admin ve a fila -> aprovar/recusar muda o status que o proprio
 * Parceiro le em `/parceiros/mim`.
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

/* Mesma tecnica de `super-admin.test.ts`: `randomInt` na frente evita colisao
   entre processos de teste nascidos no mesmo milissegundo. */
function cnpjDeTeste(): string {
  return cnpjValido(`${randomInt(1_000_000, 9_999_999)}${String(Date.now()).slice(-5)}`)
}

function codigoUnico(): string {
  return `ZZ${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

describe.skipIf(!DATABASE_URL)('conta de parceiro, ponta a ponta — NR-115', () => {
  let app: FastifyInstance
  let composicao: Composicao
  let adminToken: string

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
    registerAdminRoutes(app, authDeps)
    registerPartnersRoutes(app, authDeps)

    await app.ready()

    /* Bootstrap do Super Admin, direto no banco — mesma tecnica de super-admin.test.ts. */
    const sql = getClient(DATABASE_URL!)
    const email = `super-admin-${randomUUID()}@plataforma.local`
    const [linha] = await sql<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES ('Super Admin de Teste', ${email})
      RETURNING id
    `
    await sql`INSERT INTO platform_admins (user_id, granted_by) VALUES (${linha!.id}, ${linha!.id})`
    adminToken = await authDeps.sessions.issue(
      { userId: linha!.id, companyId: null },
      new Date(Date.now() + 3_600_000),
    )
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

  async function cadastrarComoParceiro(couponCode: string) {
    const cadastro = signupInputSchema.parse({
      name: 'Candidata a Parceira',
      email: `parceira-${randomUUID()}@loja.local`,
      secret: 'senha-de-teste',
      legalName: 'Candidata a Parceira LTDA',
      cnpj: cnpjDeTeste(),
      acceptedLegalTerms: true,
      account: {
        type: 'parceiro',
        pixKey: '41999990000',
        pixKeyType: 'PHONE',
        message: 'Quero divulgar o Buddy para meus clientes.',
        couponCode,
      },
    })
    const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: cadastro })
    expect(r.statusCode).toBe(201)
    return r.json() as { token: string; activeCompanyId: string }
  }

  it('cadastro sem `account` continua funcionando como sempre — sem candidatura', async () => {
    const cadastro = signupInputSchema.parse({
      name: 'Lojista Comum',
      email: `lojista-${randomUUID()}@loja.local`,
      secret: 'senha-de-teste',
      legalName: 'Lojista Comum LTDA',
      cnpj: cnpjDeTeste(),
      acceptedLegalTerms: true,
    })
    const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: cadastro })
    expect(r.statusCode).toBe(201)
    const sessao = r.json()

    const rMinha = await comToken(sessao.token, { method: 'GET', url: '/parceiros/mim' })
    expect(rMinha.statusCode).toBe(200)
    expect(rMinha.json()).toEqual({ application: null })
  })

  it('cadastro com `account.type: "parceiro"` cria candidatura pending', async () => {
    const sessao = await cadastrarComoParceiro(codigoUnico())

    /* A conta ja funciona como lojista — sessao aberta, empresa ativa. */
    expect(sessao.activeCompanyId).toBeTruthy()

    const rMinha = await comToken(sessao.token, { method: 'GET', url: '/parceiros/mim' })
    expect(rMinha.statusCode).toBe(200)
    expect(rMinha.json().application.status).toBe('pending')
  })

  it('quem nao e Super Admin recebe 403 em /admin/parceiros', async () => {
    const sessao = await cadastrarComoParceiro(codigoUnico())
    const r = await comToken(sessao.token, { method: 'GET', url: '/admin/parceiros' })
    expect(r.statusCode).toBe(403)
  })

  it('Super Admin ve a candidatura na fila, aprova, e o Parceiro ve o status mudar', async () => {
    const codigo = codigoUnico()
    const sessao = await cadastrarComoParceiro(codigo)

    const rFila = await comToken(adminToken, { method: 'GET', url: '/admin/parceiros' })
    expect(rFila.statusCode).toBe(200)
    const fila = rFila.json().applications as { partnerId: string; couponCode: string | null }[]
    const minhaNaFila = fila.find((f) => f.couponCode === codigo)
    expect(minhaNaFila).toBeDefined()

    const rAprovar = await comToken(adminToken, {
      method: 'POST',
      url: `/admin/parceiros/${minhaNaFila!.partnerId}/aprovar`,
      payload: { note: 'Tudo certo' },
    })
    expect(rAprovar.statusCode).toBe(200)

    const rMinha = await comToken(sessao.token, { method: 'GET', url: '/parceiros/mim' })
    expect(rMinha.json().application.status).toBe('active')
  })

  it('Super Admin recusa, e o Parceiro consegue reenviar depois', async () => {
    const sessao = await cadastrarComoParceiro(codigoUnico())

    const rMinhaAntes = await comToken(sessao.token, { method: 'GET', url: '/parceiros/mim' })
    const partnerId = (rMinhaAntes.json().application as { partnerId: string }).partnerId

    const rRecusar = await comToken(adminToken, {
      method: 'POST',
      url: `/admin/parceiros/${partnerId}/recusar`,
      payload: {},
    })
    expect(rRecusar.statusCode).toBe(200)

    const rMinhaDepois = await comToken(sessao.token, { method: 'GET', url: '/parceiros/mim' })
    expect(rMinhaDepois.json().application.status).toBe('rejected')

    const rReenviar = await comToken(sessao.token, {
      method: 'POST',
      url: '/parceiros/reenviar',
      payload: { pixKey: '41988887777', pixKeyType: 'PHONE', message: 'Motivo novo, mais longo' },
    })
    expect(rReenviar.statusCode).toBe(200)

    const rMinhaFinal = await comToken(sessao.token, { method: 'GET', url: '/parceiros/mim' })
    expect(rMinhaFinal.json().application.status).toBe('pending')
    expect(rMinhaFinal.json().application.pixKey).toBe('41988887777')
  })
})
