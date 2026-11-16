import { InMemoryAuditTrail, InMemoryChartOfAccounts, PLANO_DE_CONTAS_PADRAO } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { type ContabilidadeDeps, registerContabilidadeRoutes } from './contabilidade.js'

/**
 * Rotas do plano de contas e do DRE — NR-077, RF-081 a RF-086.
 *
 * As regras tem teste em `core` e a aritmetica em `domain`. Aqui se prova o que
 * so a rota faz: a forma que entra, o codigo que sai, e o periodo — que e o
 * unico parametro desta area capaz de mudar o relatorio inteiro.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
}

const EMPRESA = 'empresa-1'

async function buildApp(principal: AuthenticatedPrincipal | null = PRINCIPAL) {
  const accounts = new InMemoryChartOfAccounts()
  const deps: ContabilidadeDeps = { accounts, audit: new InMemoryAuditTrail() }

  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    if (principal !== null) request.principal = principal
  })
  registerContabilidadeRoutes(app, deps)

  return { app, accounts }
}

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
})

describe('o plano — RF-081, RF-082', () => {
  it('lista o que a empresa tem', async () => {
    const c = await buildApp()
    app = c.app
    c.accounts.semearPadrao(EMPRESA)

    const r = await app.inject({ method: 'GET', url: '/contas-contabeis' })

    expect(r.statusCode).toBe(200)
    expect(r.json().accounts).toHaveLength(PLANO_DE_CONTAS_PADRAO.length)
  })

  it('cria com 201', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/contas-contabeis',
      payload: { name: 'Estacionamento', type: 'expense' },
    })

    expect(r.statusCode).toBe(201)
    expect(r.json()).toMatchObject({ name: 'Estacionamento', isDefault: false })
  })

  it('recusa tipo que nao existe', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/contas-contabeis',
      payload: { name: 'Alguma coisa', type: 'ativo' },
    })

    /* Quatro tipos e a decisao de produto inteira desta area: aceitar um quinto
       poria uma linha no DRE que a aritmetica de `domain` nao sabe somar. */
    expect(r.statusCode).toBe(400)
  })

  it('renomeia pelo id do caminho', async () => {
    const c = await buildApp()
    app = c.app
    const criada = (
      await app.inject({
        method: 'POST',
        url: '/contas-contabeis',
        payload: { name: 'Marketing digital', type: 'expense' },
      })
    ).json()

    const r = await app.inject({
      method: 'PATCH',
      url: `/contas-contabeis/${criada.id}`,
      payload: { name: 'Propaganda' },
    })

    expect(r.statusCode).toBe(200)
    expect(r.json().name).toBe('Propaganda')
  })

  it('apaga com 204, sem corpo', async () => {
    const c = await buildApp()
    app = c.app
    const criada = (
      await app.inject({
        method: 'POST',
        url: '/contas-contabeis',
        payload: { name: 'Conta passageira', type: 'expense' },
      })
    ).json()

    const r = await app.inject({ method: 'DELETE', url: `/contas-contabeis/${criada.id}` })

    expect(r.statusCode).toBe(204)
    expect(r.body).toBe('')
  })
})

describe('classificar — RF-083', () => {
  it('grava a conta do lancamento', async () => {
    const c = await buildApp()
    app = c.app
    c.accounts.semearPadrao(EMPRESA)
    const conta = c.accounts.contaPorNome(EMPRESA, 'Aluguel')!

    const r = await app.inject({
      method: 'PUT',
      url: '/lancamentos/payable/3d1f0c4e-6a2b-4c8d-9e1f-0a2b3c4d5e6f/conta',
      payload: { accountId: conta.id },
    })

    expect(r.statusCode).toBe(200)
  })

  it('recusa tipo de lancamento que nao existe', async () => {
    const c = await buildApp()
    app = c.app
    c.accounts.semearPadrao(EMPRESA)
    const conta = c.accounts.contaPorNome(EMPRESA, 'Aluguel')!

    const r = await app.inject({
      method: 'PUT',
      url: '/lancamentos/venda/3d1f0c4e-6a2b-4c8d-9e1f-0a2b3c4d5e6f/conta',
      payload: { accountId: conta.id },
    })

    /* So conta a pagar e recebivel existem. `venda` no caminho viraria um
       UPDATE em tabela nenhuma se a rota nao recusasse. */
    expect(r.statusCode).toBe(400)
  })
})

describe('o DRE — RF-085, RF-086', () => {
  it('exige o periodo, em vez de inventar o mes atual', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/relatorios/dre' })

    /*
     * Um padrao escondido aqui faria a tela, o assistente e a exportacao
     * discordarem no dia 1 de cada mes — cada um com a sua ideia de qual e o
     * mes corrente. Quem escolhe o periodo e quem pergunta.
     */
    expect(r.statusCode).toBe(400)
  })

  it('recusa periodo de tras para frente', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'GET',
      url: '/relatorios/dre?from=2026-09-30&to=2026-09-01',
    })

    expect(r.statusCode).toBe(400)
  })

  it('periodo sem movimento devolve zeros, e nao erro', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'GET',
      url: '/relatorios/dre?from=2026-09-01&to=2026-09-30',
    })

    /*
     * US-041: "vejo zeros explicitos, nao erro". Zero responde a pergunta; um
     * 404 deixaria o lojista sem saber se o mes foi parado ou se a tela
     * quebrou.
     */
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({
      grossRevenueCents: 0,
      resultCents: 0,
      grossMarginPoints: null,
    })
    /* So as linhas fixas do formato gerencial (impostos e tarifas), zeradas. */
    expect(r.json().lines.map((l: { amountCents: number }) => l.amountCents)).toEqual([0, 0])
  })

  it('soma o periodo e devolve as linhas que o compoem', async () => {
    const c = await buildApp()
    app = c.app
    c.accounts.semearPadrao(EMPRESA)
    const venda = c.accounts.contaPorNome(EMPRESA, 'Venda de mercadoria')!
    const aluguel = c.accounts.contaPorNome(EMPRESA, 'Aluguel')!

    c.accounts.adicionarLancamento(EMPRESA, {
      entryKind: 'receivable',
      entryId: 'rec-1',
      accountId: venda.id,
      accountName: venda.name,
      accountType: 'revenue',
      amountCents: 100_000,
      occurredOn: '2026-09-10',
    })
    c.accounts.adicionarLancamento(EMPRESA, {
      entryKind: 'payable',
      entryId: 'pag-1',
      accountId: aluguel.id,
      accountName: aluguel.name,
      accountType: 'expense',
      amountCents: 30_000,
      occurredOn: '2026-09-12',
    })

    const r = await app.inject({
      method: 'GET',
      url: '/relatorios/dre?from=2026-09-01&to=2026-09-30',
    })

    expect(r.json()).toMatchObject({
      grossRevenueCents: 100_000,
      expensesCents: 30_000,
      resultCents: 70_000,
      /* O formato gerencial (achado do QA) sai junto, com o mesmo resultado. */
      netSalesCents: 100_000,
      contributionMarginCents: 100_000,
      operatingExpensesCents: 30_000,
      operatingResultCents: 70_000,
    })
    const comMovimento = r
      .json()
      .lines.filter((l: { entryCount: number }) => l.entryCount > 0)
      .map((l: { group: string }) => l.group)
    expect(comMovimento).toEqual(['sales', 'expenses'])
  })

  it('a exportacao sai no formato da margem de contribuicao', async () => {
    const c = await buildApp()
    app = c.app
    c.accounts.semearPadrao(EMPRESA)
    const venda = c.accounts.contaPorNome(EMPRESA, 'Venda de mercadoria')!
    const aluguel = c.accounts.contaPorNome(EMPRESA, 'Aluguel')!
    c.accounts.adicionarLancamento(EMPRESA, {
      entryKind: 'receivable',
      entryId: 'rec-1',
      accountId: venda.id,
      accountName: venda.name,
      accountType: 'revenue',
      amountCents: 100_000,
      occurredOn: '2026-09-10',
    })
    c.accounts.adicionarLancamento(EMPRESA, {
      entryKind: 'payable',
      entryId: 'pag-1',
      accountId: aluguel.id,
      accountName: aluguel.name,
      accountType: 'expense',
      amountCents: 30_000,
      occurredOn: '2026-09-12',
    })

    const r = await app.inject({
      method: 'GET',
      url: '/relatorios/dre/exportar?formato=csv&from=2026-09-01&to=2026-09-30',
    })

    expect(r.statusCode).toBe(200)
    const texto = r.body
    const ordem = [
      'Vendas brutas',
      '(−) Descontos',
      '= Venda líquida',
      '(−) Custos variáveis',
      '= Margem de contribuição',
      '(−) Aluguel',
      '= Resultado operacional',
    ].map((rotulo) => texto.indexOf(rotulo))
    expect(ordem.every((i) => i >= 0)).toBe(true)
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem)
  })
})

describe('quem pode', () => {
  it('sem sessao, 401', async () => {
    const c = await buildApp(null)
    app = c.app

    expect((await app.inject({ method: 'GET', url: '/contas-contabeis' })).statusCode).toBe(401)
  })

  it('o contador le o DRE mas nao mexe no plano', async () => {
    const c = await buildApp({ ...PRINCIPAL, role: 'accountant' })
    app = c.app

    /* Ler e metade do trabalho dele — e este relatorio e o que ele mais abre. */
    expect(
      (await app.inject({ method: 'GET', url: '/relatorios/dre?from=2026-09-01&to=2026-09-30' }))
        .statusCode,
    ).toBe(200)

    const escrita = await app.inject({
      method: 'POST',
      url: '/contas-contabeis',
      payload: { name: 'Conta do contador', type: 'expense' },
    })

    expect(escrita.statusCode).toBe(403)
  })
})
