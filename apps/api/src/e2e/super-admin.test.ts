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
import { registerCadastroRoutes } from '../routes/cadastro.js'

/**
 * Super Admin, ponta a ponta — ADR-0007, RF-131.
 *
 * Mesmo desenho do `caminho-critico.test.ts`: api de verdade, rotas reais,
 * composicao real, Postgres real. O que este arquivo prova e o que so
 * aparece na COSTURA entre as camadas — RLS real, sessao real, rota real —
 * e nao dentro de uma peca isolada:
 *
 * - `POST /admin/entrar` faz uma rota de negocio ja existente (`/produtos`)
 *   funcionar para o Super Admin, sem essa rota saber que ele existe;
 * - `POST /admin/sair` faz a MESMA rota voltar a responder 401;
 * - `POST /admin/super-admins` cria conta nova quando o e-mail nao existe.
 *
 * O bootstrap do primeiro Super Admin entra direto no banco (a mesma
 * insercao que `packages/db/src/super-admin.test.ts` usa) — e exatamente
 * assim que o bootstrap de producao funciona: nao existe rota para o
 * primeiro, so para o segundo em diante.
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

describe.skipIf(!DATABASE_URL)('super admin, ponta a ponta — ADR-0007', () => {
  let app: FastifyInstance
  let composicao: Composicao
  let empresaId: string
  let adminUserId: string
  let adminToken: string
  let donoToken: string

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
    registerCadastroRoutes(app, composicao.buildCadastroDeps())

    await app.ready()

    /* Empresa alvo: nasce pelo cadastro normal, como qualquer loja. */
    const cadastro = signupInputSchema.parse({
      name: 'Dona da Loja Alvo',
      email: `dona-${randomUUID()}@loja.local`,
      secret: 'senha-de-teste',
      legalName: 'Loja Alvo do Super Admin LTDA',
      cnpj: CNPJ,
      acceptedLegalTerms: true,
    })
    const rCadastro = await app.inject({ method: 'POST', url: '/auth/signup', payload: cadastro })
    expect(rCadastro.statusCode).toBe(201)
    const sessaoDono = rCadastro.json()
    empresaId = sessaoDono.activeCompanyId
    donoToken = sessaoDono.token

    /*
     * O bootstrap do primeiro Super Admin — direto no banco, sem rota.
     *
     * `sql()` aqui e a conexao da PROPRIA api (superusuario no runner de
     * teste, como o `caminho-critico.test.ts` ja observa) — insercao de
     * setup, nao assercao.
     */
    const sql = getClient(DATABASE_URL!)
    const email = `super-admin-${randomUUID()}@plataforma.local`
    const [linha] = await sql<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES (${'Super Admin de Teste'}, ${email})
      RETURNING id
    `
    adminUserId = linha!.id
    await sql`INSERT INTO platform_admins (user_id, granted_by) VALUES (${adminUserId}, ${adminUserId})`

    /* A sessao do Super Admin nasce direto pelo emissor — `login()` ja tem
       cobertura propria em `core` para o caminho "zero vinculo, e Super
       Admin". Aqui o que importa e o que vem DEPOIS de ter uma sessao. */
    adminToken = await authDeps.sessions.issue(
      { userId: adminUserId, companyId: null },
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
    opcoes: { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: object },
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

  it('recusa /admin/entrar para quem nao e Super Admin', async () => {
    const r = await comToken(donoToken, {
      method: 'POST',
      url: '/admin/entrar',
      payload: { companyId: empresaId, justification: 'Tentando sem ser Super Admin' },
    })
    expect(r.statusCode).toBe(403)
  })

  it('GET /admin/empresas lista a empresa alvo', async () => {
    const r = await comToken(adminToken, { method: 'GET', url: '/admin/empresas' })
    expect(r.statusCode).toBe(200)
    const corpo = r.json() as { companies: { id: string }[] }
    expect(corpo.companies.map((c) => c.id)).toContain(empresaId)
  })

  it('rota de negocio recusa o Super Admin ANTES de ele entrar em alguma empresa', async () => {
    const r = await comToken(adminToken, { method: 'GET', url: '/produtos' })
    expect(r.statusCode).toBe(401)
  })

  it('POST /admin/entrar: a MESMA rota de negocio passa a funcionar', async () => {
    const rEntrar = await comToken(adminToken, {
      method: 'POST',
      url: '/admin/entrar',
      payload: { companyId: empresaId, justification: 'Verificando cadastro de produtos da loja' },
    })
    expect(rEntrar.statusCode).toBe(200)
    expect(rEntrar.json()).toEqual({ activeCompanyId: empresaId, role: 'owner' })

    const rProdutos = await comToken(adminToken, { method: 'GET', url: '/produtos' })
    expect(rProdutos.statusCode).toBe(200)
  })

  it('POST /admin/sair: a rota de negocio volta a recusar', async () => {
    const rSair = await comToken(adminToken, { method: 'POST', url: '/admin/sair' })
    expect(rSair.statusCode).toBe(200)
    expect(rSair.json()).toEqual({ activeCompanyId: null })

    const rProdutos = await comToken(adminToken, { method: 'GET', url: '/produtos' })
    expect(rProdutos.statusCode).toBe(401)
  })

  it('POST /admin/super-admins com e-mail novo: cria conta e devolve senha temporaria', async () => {
    const email = `novo-super-${randomUUID()}@plataforma.local`
    const r = await comToken(adminToken, {
      method: 'POST',
      url: '/admin/super-admins',
      payload: { email, name: 'Segundo Admin' },
    })

    expect(r.statusCode).toBe(201)
    const corpo = r.json() as { created: boolean; temporaryPassword?: string }
    expect(corpo.created).toBe(true)
    expect(corpo.temporaryPassword).toBeDefined()
  })

  it('GET /admin/super-admins lista quem e Super Admin', async () => {
    const r = await comToken(adminToken, { method: 'GET', url: '/admin/super-admins' })
    expect(r.statusCode).toBe(200)
    const corpo = r.json() as { admins: { userId: string }[] }
    expect(corpo.admins.map((a) => a.userId)).toContain(adminUserId)
  })

  /**
   * Revogar — ADR-0007.
   *
   * A funcao SQL existia desde a migration 0008 sem caminho ate a api: dava
   * para conceder o maior privilegio do sistema e nao dava para tirar.
   */
  it('DELETE /admin/super-admins/:id tira o acesso, e a lista deixa de traze-lo', async () => {
    const email = `revogavel-${randomUUID()}@plataforma.local`
    const criado = await comToken(adminToken, {
      method: 'POST',
      url: '/admin/super-admins',
      payload: { email, name: 'Vai Perder o Acesso' },
    })
    const { userId } = criado.json() as { userId: string }

    const antes = await comToken(adminToken, { method: 'GET', url: '/admin/super-admins' })
    expect(
      (antes.json() as { admins: { userId: string }[] }).admins.map((a) => a.userId),
    ).toContain(userId)

    const r = await comToken(adminToken, {
      method: 'DELETE',
      url: `/admin/super-admins/${userId}`,
    })
    expect(r.statusCode).toBe(204)

    const depois = await comToken(adminToken, { method: 'GET', url: '/admin/super-admins' })
    expect(
      (depois.json() as { admins: { userId: string }[] }).admins.map((a) => a.userId),
    ).not.toContain(userId)
  })

  it('revogar a si mesmo e recusado — e o que impede a plataforma ficar sem dono', async () => {
    const r = await comToken(adminToken, {
      method: 'DELETE',
      url: `/admin/super-admins/${adminUserId}`,
    })

    expect(r.statusCode).toBe(400)

    /* E continua Super Admin: a recusa nao pode ter efeito pela metade. */
    const lista = await comToken(adminToken, { method: 'GET', url: '/admin/super-admins' })
    expect(
      (lista.json() as { admins: { userId: string }[] }).admins.map((a) => a.userId),
    ).toContain(adminUserId)
  })

  it('quem nao e Super Admin nao revoga ninguem', async () => {
    const r = await comToken(donoToken, {
      method: 'DELETE',
      url: `/admin/super-admins/${adminUserId}`,
    })

    expect(r.statusCode).toBe(403)
  })
})
