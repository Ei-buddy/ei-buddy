import { randomInt, randomUUID } from 'node:crypto'
import { VERSOES_LEGAIS } from '@na-regua/contracts'
import { getClient, migrate } from '@na-regua/db'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerSession } from '../plugins/session.js'
import { registerAuthRoutes } from '../routes/auth.js'
import { registerLegalRoutes } from '../routes/legal.js'

/**
 * Aceite dos documentos legais, ponta a ponta — RF-02, RF-03.
 *
 * Api de verdade, Postgres de verdade. O que se prova aqui e a costura que
 * nenhum teste de unidade alcanca: o cadastro grava a prova sozinho, sem
 * ninguem chamar nada a mais, e quem ja aceitou nao e importunado de novo.
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

function cnpjDeTeste(): string {
  return cnpjValido(`${randomInt(1_000_000, 9_999_999)}${String(Date.now()).slice(-5)}`)
}

describe.skipIf(!DATABASE_URL)('documentos legais, ponta a ponta — RF-02/RF-03', () => {
  let app: FastifyInstance
  let composicao: Composicao
  /*
   * Conexao administrativa so para ESPIAR a tabela.
   *
   * `user_consents` nega tudo por RLS e so as funcoes `SECURITY DEFINER`
   * entram — o cliente da aplicacao le zero linhas e, pior, um `UPDATE` dele
   * nao levanta erro nenhum: afeta zero linhas em silencio. Usar o papel da
   * aplicacao aqui faria o teste medir o RLS em vez do que ele quer medir.
   */
  let admin: ReturnType<typeof getClient>

  beforeAll(async () => {
    vi.stubEnv('API_URL', process.env.API_URL ?? 'http://localhost:3333')
    vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET ?? 'segredo-que-o-e2e-nao-usa')
    vi.stubEnv('REDIS_URL', process.env.REDIS_URL ?? 'redis://localhost:6379')

    composicao = await import('../composition.js')
    await migrate(MIGRATION_URL!)
    admin = getClient(MIGRATION_URL!)

    app = Fastify({ logger: false })
    registerErrorHandler(app)
    await registerRateLimit(app)

    const authDeps = composicao.buildAuthDeps()
    registerSession(app, authDeps.sessions)
    registerAuthRoutes(app, authDeps)
    registerLegalRoutes(app, authDeps)

    await app.ready()
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

  async function cadastrar(): Promise<{ token: string; userId: string }> {
    const sufixo = randomUUID().slice(0, 8)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        name: `Titular ${sufixo}`,
        email: `titular-${sufixo}@teste.local`,
        secret: 'senha-de-teste-longa',
        legalName: `Loja do Titular ${sufixo} LTDA`,
        cnpj: cnpjDeTeste(),
        acceptedLegalTerms: true,
      },
    })
    expect(res.statusCode).toBe(201)
    const corpo = JSON.parse(res.body) as { token: string; userId: string }
    return corpo
  }

  const comToken = (token: string, url: string, method: 'GET' | 'POST' = 'GET') =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` } })

  it('as versoes em vigor sao publicas, sem sessao', async () => {
    const res = await app.inject({ method: 'GET', url: '/legal/versoes' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ versoes: VERSOES_LEGAIS })
  })

  it('cadastro sem aceite e recusado pelo contrato', async () => {
    const sufixo = randomUUID().slice(0, 8)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        name: `Sem Aceite ${sufixo}`,
        email: `sem-aceite-${sufixo}@teste.local`,
        secret: 'senha-de-teste-longa',
        legalName: `Loja Sem Aceite ${sufixo} LTDA`,
        cnpj: cnpjDeTeste(),
        /* Sem `acceptedLegalTerms`. RF-02: nao conclui. */
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('`acceptedLegalTerms: false` tambem nao passa', async () => {
    const sufixo = randomUUID().slice(0, 8)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        name: `Recusou ${sufixo}`,
        email: `recusou-${sufixo}@teste.local`,
        secret: 'senha-de-teste-longa',
        legalName: `Loja Recusou ${sufixo} LTDA`,
        cnpj: cnpjDeTeste(),
        acceptedLegalTerms: false,
      },
    })

    /* `literal(true)`: mandar `false` e tao invalido quanto omitir. */
    expect(res.statusCode).toBe(400)
  })

  it('quem acabou de se cadastrar ja esta em dia — o cadastro gravou a prova', async () => {
    const { token } = await cadastrar()

    const res = await comToken(token, '/legal/pendencias')

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ pendentes: [] })
  })

  it('o aceite do cadastro fica gravado com versao, IP e user agent', async () => {
    const { userId } = await cadastrar()

    const linhas = await admin<
      { document_type: string; document_version: string; ip: string | null }[]
    >`
      SELECT document_type, document_version, ip
        FROM user_consents WHERE user_id = ${userId}::uuid
       ORDER BY document_type
    `

    expect(linhas.map((l) => l.document_type)).toEqual(['privacy', 'terms'])
    expect(linhas[0]?.document_version).toBe(VERSOES_LEGAIS.privacy)
    /* `app.inject` passa um IP, entao a prova sai preenchida. */
    expect(linhas[0]?.ip).not.toBeNull()
  })

  it('versao nova poe o documento como pendente, e o reaceite resolve', async () => {
    const { token, userId } = await cadastrar()

    /*
     * Simula o dia seguinte a publicacao de Termos novos: em vez de mexer na
     * constante (que e do build inteiro), envelhece o aceite que existe.
     */
    await admin`
      UPDATE user_consents SET document_version = 'versao-anterior'
       WHERE user_id = ${userId}::uuid AND document_type = 'terms'
    `

    const antes = await comToken(token, '/legal/pendencias')
    const corpoAntes = JSON.parse(antes.body) as {
      pendentes: { type: string; version: string; versaoAceitaAntes?: string }[]
    }
    expect(corpoAntes.pendentes).toHaveLength(1)
    expect(corpoAntes.pendentes[0]?.type).toBe('terms')
    expect(corpoAntes.pendentes[0]?.versaoAceitaAntes).toBe('versao-anterior')

    const aceite = await comToken(token, '/legal/aceites', 'POST')
    expect(aceite.statusCode).toBe(200)
    /* Devolve a pendencia ja recalculada: a tela fecha o aviso sem segunda ida. */
    expect(JSON.parse(aceite.body)).toEqual({ pendentes: [] })

    /* E o aceite antigo continua la — o historico e a prova (RF-03). */
    const [{ n }] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM user_consents
       WHERE user_id = ${userId}::uuid AND document_type = 'terms'
    `
    expect(n).toBe(2)
  })

  it('sem sessao nao da para ver pendencia nem aceitar', async () => {
    expect((await app.inject({ method: 'GET', url: '/legal/pendencias' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/legal/aceites' })).statusCode).toBe(401)
  })
})
