import {
  FakeIdentityProvider,
  InMemoryAuditTrail,
  InMemoryLoginThrottle,
  InMemorySessionIssuer,
  InMemoryChartOfAccounts,
  InMemoryCompanyRepository,
  InMemoryLegalConsentRepository,
  InMemoryPlatformAdminAccess,
} from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_AUTENTICACAO, registerRateLimit } from '../plugins/rate-limit.js'
import { lerToken, registerSession } from '../plugins/session.js'
import { type AuthRouteDeps, registerAuthRoutes } from './auth.js'

/**
 * O ciclo inteiro pelo Fastify: entrar, escolher loja, e so entao operar.
 *
 * O que estas rotas prometem e um par status + corpo E o efeito de popular
 * `request.principal` — e o segundo so aparece com uma rota protegida de
 * verdade do outro lado. Por isso a suite monta uma.
 */

const CREDENCIAL = { identifier: 'marta@mercado.local', secret: 'senha-de-teste' }

async function buildApp() {
  const users = new (class {
    /* Diretorio minimo: o suficiente para login e escolha de loja. */
    usuarios = new Map([['sub-marta', { id: 'user-marta', name: 'Marta', isActive: true }]])
    vinculos = [
      { companyId: 'empresa-1', companyName: 'Mercado da Marta', role: 'owner' as const },
      { companyId: 'empresa-2', companyName: 'Mercado do Centro', role: 'staff' as const },
    ]
    async findById(id: string) {
      return [...this.usuarios.values()].find((u) => u.id === id)
    }
    async findBySubject(sub: string) {
      return this.usuarios.get(sub)
    }
    async findByEmail() {
      return undefined
    }
    async findByPhone() {
      return undefined
    }
    async attachSubject() {}
    /* Vinculos por usuario, alem dos fixos da Marta: o cadastro cria pessoa e
       loja novas, e o login logo depois precisa achar o vinculo DELA. */
    porUsuario = new Map<string, { companyId: string; companyName: string; role: 'owner' }[]>()
    async listMemberships(userId: string) {
      return this.porUsuario.get(userId) ?? this.vinculos
    }
    async findMembership(companyId: string) {
      return this.vinculos.find((v) => v.companyId === companyId)
    }
    /**
     * O cadastro (NR-014) usa este caminho.
     *
     * Guarda o usuario sob o `subject` que o provedor falso emite
     * (`fake:<identificador>`) — sem isso o login seguinte acharia a
     * credencial valida e nenhum usuario, e recusaria com a mesma mensagem de
     * senha errada.
     */
    async createUserWithAccess(convite: { companyId: string; name: string; email: string | null }) {
      const usuario = { id: `user-${this.usuarios.size + 1}`, name: convite.name, isActive: true }
      this.usuarios.set(`fake:${convite.email}`, usuario)
      this.porUsuario.set(usuario.id, [
        { companyId: convite.companyId, companyName: convite.name, role: 'owner' },
      ])
      return usuario
    }
    async grantAccess() {
      throw new Error('nao usado')
    }
  })()

  const provider = new FakeIdentityProvider()
  /* O falso so conhece o que foi registrado — e o que o torna util: credencial
     errada e errada de verdade, nao "qualquer coisa passa". */
  provider.registrar(CREDENCIAL.identifier, CREDENCIAL.secret, {
    subject: 'sub-marta',
    email: CREDENCIAL.identifier,
  })
  const deps = {
    provider,
    /* A MESMA instancia registra e verifica — duas seriam dois mapas de
       credencial, e o cadastro escreveria num enquanto o login leria do outro. */
    registrar: provider,
    users,
    companies: new InMemoryCompanyRepository(),
    accounts: new InMemoryChartOfAccounts(),
    sessions: new InMemorySessionIssuer(),
    throttle: new InMemoryLoginThrottle(),
    audit: new InMemoryAuditTrail(),
    /* O cadastro grava a prova do aceite (RF-02) — sem isto, `signup` quebra. */
    legalConsents: new InMemoryLegalConsentRepository(),
    /* O login confere Super Admin em TODO acesso, e nao so para quem nao tem
       loja (ADR-0007) — sem isto, `login` quebra. */
    platformAdmin: new InMemoryPlatformAdminAccess({
      aoEntrar: () => undefined,
      aoSair: () => undefined,
    }),
  } as unknown as AuthRouteDeps

  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  /* O limitador entra AQUI tambem: `config.rateLimit` numa rota sem o plugin
     registrado nao limita nada e nao avisa. Sem isto, a suite passaria verde
     sobre um controle de seguranca desligado. */
  await registerRateLimit(app)
  registerSession(app, deps.sessions)
  registerAuthRoutes(app, deps)

  /* Rota protegida de mentira, para provar o efeito do plugin de sessao. */
  app.get('/protegida', async (request) => {
    const ctx = requireContext(request)
    return { companyId: ctx.companyId, role: ctx.role }
  })

  return { app, deps, users }
}

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
})

const entrar = (a: FastifyInstance) =>
  a.inject({ method: 'POST', url: '/auth/login', payload: CREDENCIAL })

const protegida = (a: FastifyInstance, token: string) =>
  a.inject({ method: 'GET', url: '/protegida', headers: { authorization: `Bearer ${token}` } })

/**
 * Entra E escolhe a loja, devolvendo o token operavel.
 *
 * A credencial do teste tem DUAS lojas, entao o token do login sai com
 * `companyId: null` e nao abre rota protegida — de proposito (ver o describe de
 * "sessao sem empresa nao opera"). Quem quer um token que opera precisa passar
 * pela escolha.
 */
async function entrarEEscolher(a: FastifyInstance): Promise<string> {
  const primeiro = (await entrar(a)).json().token
  const r = await a.inject({
    method: 'POST',
    url: '/auth/select-company',
    headers: { authorization: `Bearer ${primeiro}` },
    payload: { companyId: 'empresa-1' },
  })
  return r.json().token as string
}

describe('leitura do cabecalho', () => {
  const req = (authorization?: string) =>
    ({ headers: authorization === undefined ? {} : { authorization } }) as never

  it('le o token depois de Bearer', () => {
    expect(lerToken(req('Bearer abc123'))).toBe('abc123')
  })

  it.each([undefined, '', 'abc123', 'Basic abc', 'Bearer ', 'Bearer    '])(
    'ignora %s',
    (header) => {
      expect(lerToken(req(header))).toBeUndefined()
    },
  )
})

describe('entrar — RF-119', () => {
  it('devolve token, vinculos e nome', async () => {
    const c = await buildApp()
    app = c.app

    const r = await entrar(app)

    expect(r.statusCode).toBe(200)
    expect(r.json().token).toBeTruthy()
    expect(r.json().userName).toBe('Marta')
    expect(r.json().memberships).toHaveLength(2)
  })

  /**
   * Quem opera mais de uma loja entra e DEPOIS escolhe (US-059). Nao e estado
   * de erro — e por isso responde 200 e nao 4xx.
   */
  it('com duas lojas, entra sem empresa ativa', async () => {
    const c = await buildApp()
    app = c.app

    const r = await entrar(app)

    expect(r.json().activeCompanyId).toBeNull()
  })

  it('credencial errada responde 401', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: 'ninguem@x.local', secret: 'errada' },
    })

    expect(r.statusCode).toBe(401)
  })

  it('corpo invalido responde 400', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: '' } })

    expect(r.statusCode).toBe(400)
  })
})

/**
 * O ponto do plugin de sessao. Sessao sem empresa NAO vira principal: ela nao
 * tem papel, e um principal sem papel entraria em `assertCanWrite` como
 * `undefined` — que e como verificacao de permissao vira `if` sempre falso.
 */
describe('sessao sem empresa nao opera', () => {
  it('rota protegida responde 401 mesmo com token valido', async () => {
    const c = await buildApp()
    app = c.app
    const token = (await entrar(app)).json().token

    const r = await app.inject({
      method: 'GET',
      url: '/protegida',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(r.statusCode).toBe(401)
  })

  /* Mas ela existe: `/auth/me` responde, e e como a tela sabe que precisa
     perguntar qual loja. */
  it('mas /auth/me responde, dizendo que falta escolher', async () => {
    const c = await buildApp()
    app = c.app
    const token = (await entrar(app)).json().token

    const r = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(r.statusCode).toBe(200)
    expect(r.json().activeCompanyId).toBeNull()
    expect(r.json().role).toBeNull()
  })
})

describe('escolher a loja — RF-119', () => {
  async function comLojaEscolhida(companyId = 'empresa-1') {
    const c = await buildApp()
    app = c.app
    const primeiro = (await entrar(app)).json().token
    const r = await app.inject({
      method: 'POST',
      url: '/auth/select-company',
      headers: { authorization: `Bearer ${primeiro}` },
      payload: { companyId },
    })
    return { c, r }
  }

  /*
   * O token de antes deixava de ser usado e continuava VALIDO pelas doze horas
   * restantes — e o de `companyId: null` continuava podendo escolher loja de
   * novo. Antes de a sessao ser persistente nao havia onde revoga-lo (NR-083).
   */
  it('revoga o token que escolheu a loja', async () => {
    const c = await buildApp()
    app = c.app
    const primeiro = (await entrar(app)).json().token

    const r = await app.inject({
      method: 'POST',
      url: '/auth/select-company',
      headers: { authorization: `Bearer ${primeiro}` },
      payload: { companyId: 'empresa-1' },
    })

    /* O novo vale, o antigo nao. Uma segunda escolha com o token velho seria
       401 — e antes ela funcionava. */
    expect((await protegida(app, r.json().token)).statusCode).toBe(200)

    const comOVelho = await app.inject({
      method: 'POST',
      url: '/auth/select-company',
      headers: { authorization: `Bearer ${primeiro}` },
      payload: { companyId: 'empresa-2' },
    })
    expect(comOVelho.statusCode).toBe(401)
  })

  it('emite sessao com empresa e papel', async () => {
    const { r } = await comLojaEscolhida()

    expect(r.statusCode).toBe(200)
    expect(r.json().activeCompanyId).toBe('empresa-1')
  })

  it('a partir dai a rota protegida funciona, com o papel certo', async () => {
    const { r } = await comLojaEscolhida('empresa-2')

    const protegida = await app.inject({
      method: 'GET',
      url: '/protegida',
      headers: { authorization: `Bearer ${r.json().token}` },
    })

    expect(protegida.statusCode).toBe(200)
    expect(protegida.json()).toEqual({ companyId: 'empresa-2', role: 'staff' })
  })

  /* 404 e nao 403: 403 confirmaria que a loja existe para quem chutou um id. */
  it('loja sem vinculo responde 404, nao 403', async () => {
    const { r } = await comLojaEscolhida('empresa-de-outro')

    expect(r.statusCode).toBe(404)
  })

  it('sem sessao responde 401', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/auth/select-company',
      payload: { companyId: 'empresa-1' },
    })

    expect(r.statusCode).toBe(401)
  })
})

describe('token ruim nao derruba a requisicao', () => {
  it.each([
    ['token inventado', 'Bearer nao-e-token'],
    ['prefixo errado', 'Basic abc'],
  ])('%s: segue sem principal, e a rota protegida responde 401', async (_nome, authorization) => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/protegida', headers: { authorization } })

    expect(r.statusCode).toBe(401)
  })

  /* Lancar no hook transformaria um token velho num 500 em rota PUBLICA. */
  it('token invalido nao impede entrar de novo', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { authorization: 'Bearer token-velho' },
      payload: CREDENCIAL,
    })

    expect(r.statusCode).toBe(200)
  })
})

/**
 * Limite de requisicoes — RNF-026, e o alerta do CodeQL que trouxe isto.
 *
 * NAO e a mesma coisa que a desaceleracao de login. O `LoginThrottle` conta
 * tentativas FALHAS (RF-120); isto conta REQUISICOES. A diferenca aparece no
 * caso que so um dos dois pega: logins CORRETOS em rajada passam ilesos pelo
 * throttle, porque ele so conta falha, e sao barrados aqui.
 */
describe('limite de requisicoes — RNF-026', () => {
  it('barra a rajada com 429, mesmo com credencial certa', async () => {
    const c = await buildApp()
    app = c.app

    const respostas = []
    for (let i = 0; i < LIMITE_DE_AUTENTICACAO.max + 2; i += 1) {
      respostas.push((await entrar(app)).statusCode)
    }

    expect(respostas.filter((s) => s === 200)).toHaveLength(LIMITE_DE_AUTENTICACAO.max)
    expect(respostas.at(-1)).toBe(429)
  })

  /* O 429 sai pelo mesmo envelope de todo o resto: quem consome a api nao
     deveria receber outro formato so porque bateu no limite. */
  it('o 429 usa o envelope de erro do sistema', async () => {
    const c = await buildApp()
    app = c.app
    for (let i = 0; i < LIMITE_DE_AUTENTICACAO.max; i += 1) await entrar(app)

    const r = await entrar(app)

    expect(r.json().error.code).toBe('RATE_LIMITED')
    expect(r.json().error.message).toMatch(/Tente de novo em \d+ segundos/)
  })

  /* Se o plugin nao estivesse registrado, `config.rateLimit` seria ignorado em
     silencio e o teste acima passaria por acidente. Este confere o cabecalho,
     que so existe quando o limitador esta de fato ligado. */
  it('o limitador esta mesmo ligado, e nao so declarado', async () => {
    const c = await buildApp()
    app = c.app

    const r = await entrar(app)

    expect(r.headers['x-ratelimit-limit']).toBe(String(LIMITE_DE_AUTENTICACAO.max))
  })
})

describe('cadastro de conta — NR-014, RF-001', () => {
  const CADASTRO = {
    name: 'Ana Souza',
    email: 'ana@mercearia.local',
    phone: '41999990000',
    secret: 'senha-de-teste-longa',
    legalName: 'Mercearia da Ana LTDA',
    cnpj: '11222333000181',
    acceptedLegalTerms: true,
  }

  it('cria a conta e ja devolve a sessao aberta', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: CADASTRO })

    expect(r.statusCode).toBe(201)
    expect(r.json().token).toBeTruthy()
    expect(r.json().activeCompanyId).not.toBeNull()
  })

  it('DEPOIS do cadastro, o login funciona', async () => {
    const c = await buildApp()
    app = c.app

    await app.inject({ method: 'POST', url: '/auth/signup', payload: CADASTRO })

    const r = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: CADASTRO.email, secret: CADASTRO.secret },
    })

    /*
     * O teste que faltava. Antes, o cadastro nao existia — e mesmo com usuario
     * no banco o login falhava, porque o provedor de identidade nascia sem
     * credencial nenhuma. Provar que a conta e criada nao bastava: o que o
     * lojista quer e ENTRAR depois.
     */
    expect(r.statusCode).toBe(200)
    expect(r.json().activeCompanyId).not.toBeNull()
  })

  it('nao exige sessao — quem cadastra ainda nao tem', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: CADASTRO })

    /* Exigir contexto aqui seria exigir que a pessoa ja estivesse dentro para
       poder entrar. */
    expect(r.statusCode).not.toBe(401)
  })

  it('recusa CNPJ invalido antes de criar qualquer coisa', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...CADASTRO, cnpj: '00000000000000' },
    })

    expect(r.statusCode).toBe(400)
  })

  it('recusa senha curta com mensagem para o formulario', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...CADASTRO, secret: 'curta' },
    })

    /* A recusa vem daqui e nao do provedor: chegar do lado de la faria a pessoa
       perder o que digitou. */
    /* O manipulador de erro resume a mensagem e detalha em `fields` — e la que
       o formulario le qual campo recusou. */
    expect(r.statusCode).toBe(400)
    expect(JSON.stringify(r.json().error.fields)).toMatch(/8 caracteres/)
  })

  it('CNPJ repetido responde 409, sem dizer de quem e', async () => {
    const c = await buildApp()
    app = c.app

    await app.inject({ method: 'POST', url: '/auth/signup', payload: CADASTRO })

    const r = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...CADASTRO, email: 'outra@loja.local' },
    })

    expect(r.statusCode).toBe(409)
    expect(r.body).not.toContain('Mercearia da Ana')
  })
})

describe('sair — RF-119, NR-083', () => {
  const sair = (a: FastifyInstance, token?: string) =>
    a.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    })

  /*
   * O comportamento que faltava. "Sair" apagava o cookie no web e o
   * `SecureStore` no mobile, e o servidor continuava aceitando o token pelas
   * doze horas restantes — quem tivesse uma copia dele seguia dentro.
   */
  it('o token para de abrir rota protegida depois de sair', async () => {
    const c = await buildApp()
    app = c.app
    const token = await entrarEEscolher(app)
    expect((await protegida(app, token)).statusCode).toBe(200)

    const saida = await sair(app, token)

    expect(saida.statusCode).toBe(204)
    expect((await protegida(app, token)).statusCode).toBe(401)
  })

  /* Sair nao e operacao que possa falhar para quem clicou: responder 401 faria
     o cliente insistir numa tela em vez de ir para o login. */
  it('responde 204 sem token', async () => {
    const c = await buildApp()
    app = c.app

    expect((await sair(app)).statusCode).toBe(204)
  })

  it('responde 204 com token que nunca existiu', async () => {
    const c = await buildApp()
    app = c.app

    expect((await sair(app, 'nunca-existiu')).statusCode).toBe(204)
  })

  /* Sair de um aparelho nao pode deslogar o outro: cada login tem token
     proprio, e a revogacao e do token APRESENTADO. */
  it('nao derruba a outra sessao da mesma pessoa', async () => {
    const c = await buildApp()
    app = c.app
    const doCelular = await entrarEEscolher(app)
    const doComputador = await entrarEEscolher(app)

    await sair(app, doCelular)

    expect((await protegida(app, doCelular)).statusCode).toBe(401)
    expect((await protegida(app, doComputador)).statusCode).toBe(200)
  })

  /* Sair duas vezes e sair. */
  it('e idempotente', async () => {
    const c = await buildApp()
    app = c.app
    const token = await entrarEEscolher(app)

    await sair(app, token)

    expect((await sair(app, token)).statusCode).toBe(204)
  })
})
