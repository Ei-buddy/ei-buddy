import type { AccountOutput, PayableOutput } from '@na-regua/contracts'
import { InMemoryAuditTrail, InMemoryManualReceivables, InMemoryReceivables } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { type ContasDeps, registerContasRoutes } from './contas.js'

/**
 * A rota de contas a receber pelo ciclo real do Fastify — RF-064, RF-066.
 *
 * Ela faltava inteira. A baixa de recebivel existe desde a NR-029
 * (`POST /contas-a-receber/:id/baixas`), mas nao havia como LISTAR o que
 * baixar: a tela do mobile e a do web mostravam recebiveis de exemplo, e o
 * botao de baixa apontava para ids que nao existiam no banco.
 *
 * Repositorio em memoria: o que a rota promete e um par status + corpo, e
 * provar isso nao precisa de Postgres. O `receivable-repository` de verdade e
 * exercitado pelas suites de `db`.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
}

async function buildApp(
  principal: AuthenticatedPrincipal | null = PRINCIPAL,
  receivables = new InMemoryReceivables(),
  payables: readonly PayableOutput[] = [],
  accounts: readonly AccountOutput[] = [],
) {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    if (principal !== null) request.principal = principal
  })

  const audit = new InMemoryAuditTrail()
  const receivablesUow = new InMemoryManualReceivables(audit)

  const deps = {
    receivables,
    receivablesUow,
    /* A rota de LANCAR contas a pagar convive neste arquivo; ela nao e
       exercitada aqui, e um falso vazio basta para o registro nao quebrar. */
    queries: { list: async () => payables },
    accounts: { list: async () => accounts },
    uow: {},
    ids: { next: () => 'id' },
    audit,
  }

  registerContasRoutes(app, deps as unknown as ContasDeps)
  return { app, receivables, receivablesUow }
}

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
})

const doGrupo = (corpo: { grupos: { faixa: string; receivables: unknown[] }[] }, faixa: string) =>
  corpo.grupos.find((g) => g.faixa === faixa)!

describe('contas a receber — RF-064, RF-066', () => {
  it('devolve os grupos por vencimento e o total', async () => {
    const c = await buildApp()
    app = c.app
    c.receivables.adicionar('empresa-1', { dueDate: '2020-01-01', amountCents: 30_000 })

    const r = await app.inject({ method: 'GET', url: '/contas-a-receber' })

    expect(r.statusCode).toBe(200)
    expect(r.json().totalCents).toBe(30_000)
    expect(doGrupo(r.json(), 'overdue').receivables).toHaveLength(1)
  })

  it('lista vazia responde 200 com total zero, e nao 404', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/contas-a-receber' })

    /* "Nao ha nada a receber" e uma resposta legitima — e a de uma loja que
       so vende a vista. 404 diria que a lista nao existe. */
    expect(r.statusCode).toBe(200)
    expect(r.json().totalCents).toBe(0)
    expect(r.json().temVencidas).toBe(false)
  })

  it('recebivel de outra loja nao aparece', async () => {
    const c = await buildApp()
    app = c.app
    c.receivables.adicionar('outra-empresa', { dueDate: '2020-01-01', amountCents: 99_999 })

    const r = await app.inject({ method: 'GET', url: '/contas-a-receber' })

    expect(r.json().totalCents).toBe(0)
  })

  it('o que ja foi recebido fica de fora', async () => {
    const c = await buildApp()
    app = c.app
    c.receivables.adicionar('empresa-1', { dueDate: '2020-01-01', status: 'settled' })

    expect((await app.inject({ method: 'GET', url: '/contas-a-receber' })).json().totalCents).toBe(
      0,
    )
  })

  it('accountant consulta — e somente leitura, e e quem mais le esta tela', async () => {
    const c = await buildApp({ ...PRINCIPAL, role: 'accountant' })
    app = c.app
    c.receivables.adicionar('empresa-1', { dueDate: '2020-01-01' })

    expect((await app.inject({ method: 'GET', url: '/contas-a-receber' })).statusCode).toBe(200)
  })

  it('sem sessao responde 401', async () => {
    const c = await buildApp(null)
    app = c.app

    expect((await app.inject({ method: 'GET', url: '/contas-a-receber' })).statusCode).toBe(401)
  })

  /* As duas listas convivem no mesmo arquivo de rotas, sob prefixos parecidos:
     trocar uma pela outra devolveria o dinheiro que SAI onde se esperava o que
     entra. */
  it('nao confunde contas a receber com contas a pagar', async () => {
    const c = await buildApp()
    app = c.app
    c.receivables.adicionar('empresa-1', { dueDate: '2020-01-01', amountCents: 30_000 })

    const aPagar = await app.inject({ method: 'GET', url: '/contas-a-pagar' })

    expect(aPagar.statusCode).toBe(200)
    expect(aPagar.json().totalCents).toBe(0)
  })
})

describe('lancar recebivel avulso — POST /contas-a-receber, RF-065', () => {
  it('cria com 201 e devolve o recebivel', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/contas-a-receber',
      payload: { description: 'Aluguel de sala', amountCents: 80_000, dueDate: '2026-09-20' },
    })

    expect(r.statusCode).toBe(201)
    expect(r.json().description).toBe('Aluguel de sala')
    expect(r.json().amountCents).toBe(80_000)
    expect(r.json().saleId).toBeNull()
  })

  it('recusa valor zero', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/contas-a-receber',
      payload: { description: 'Zerado', amountCents: 0, dueDate: '2026-09-20' },
    })

    expect(r.statusCode).toBe(400)
  })

  it('accountant nao lanca — e escrita', async () => {
    const c = await buildApp({ ...PRINCIPAL, role: 'accountant' })
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/contas-a-receber',
      payload: { description: 'Aluguel', amountCents: 10_000, dueDate: '2026-09-20' },
    })

    expect(r.statusCode).toBe(403)
  })

  it('nao confunde com o lancamento de contas a pagar', async () => {
    const c = await buildApp()
    app = c.app

    await app.inject({
      method: 'POST',
      url: '/contas-a-receber',
      payload: { description: 'Recebivel', amountCents: 10_000, dueDate: '2026-09-20' },
    })

    /* A unidade de trabalho de pagar (`uow: {}`) nao foi chamada — se a rota
       confundisse as duas, este teste quebraria ao tentar usar o falso vazio. */
    expect(c.receivablesUow.todas('empresa-1')).toHaveLength(1)
  })
})

const PAGAVEL: PayableOutput = {
  id: 'pay-1',
  supplier: 'Energia Ltda',
  description: 'Conta de luz',
  amountCents: 30_000,
  settledAmountCents: 10_000,
  dueDate: '2020-01-01',
  status: 'partially_settled',
  attachmentKey: null,
  accountId: 'acc-1',
  recurrenceId: null,
  occurrenceNumber: null,
  occurrenceCount: null,
  createdAt: '2020-01-01T00:00:00.000Z',
}

const CONTA: AccountOutput = {
  id: 'acc-1',
  name: 'Energia e agua',
  type: 'expense',
  isDefault: false,
}

/**
 * Exportar em CSV/PDF — o botao "Exportar" que a tela ja tinha, sempre
 * respondendo com erro porque `financeiro-api.ts#exportar` nunca chamava um
 * endpoint de verdade.
 */
describe('exportar contas a pagar — GET /contas-a-pagar/exportar', () => {
  it('csv e o padrao, com o nome do plano de conta resolvido', async () => {
    const c = await buildApp(PRINCIPAL, new InMemoryReceivables(), [PAGAVEL], [CONTA])
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/contas-a-pagar/exportar' })

    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('text/csv')
    expect(r.headers['content-disposition']).toContain('contas-a-pagar.csv')
    expect(r.body).toContain('Energia Ltda')
    expect(r.body).toContain('Energia e agua')
    /* Saldo e o que FALTA pagar (20.000), nao o valor original (30.000) —
       mesma regra da tela e da listagem que a origina. */
    expect(r.body).toContain('200,00')
  })

  it('pdf de verdade — comeca com a assinatura do formato', async () => {
    const c = await buildApp(PRINCIPAL, new InMemoryReceivables(), [PAGAVEL], [CONTA])
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/contas-a-pagar/exportar?formato=pdf' })

    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('application/pdf')
    expect(r.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('formato desconhecido e 400, e nao um arquivo qualquer', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/contas-a-pagar/exportar?formato=xls' })

    expect(r.statusCode).toBe(400)
  })

  it('accountant exporta — e leitura, como a listagem que a origina', async () => {
    const c = await buildApp({ ...PRINCIPAL, role: 'accountant' })
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/contas-a-pagar/exportar' })

    expect(r.statusCode).toBe(200)
  })

  it('sem sessao responde 401', async () => {
    const c = await buildApp(null)
    app = c.app

    expect((await app.inject({ method: 'GET', url: '/contas-a-pagar/exportar' })).statusCode).toBe(
      401,
    )
  })
})

describe('exportar contas a receber — GET /contas-a-receber/exportar', () => {
  it('csv com o nome do cliente e a parcela', async () => {
    const c = await buildApp()
    app = c.app
    c.receivables.adicionar('empresa-1', {
      dueDate: '2020-01-01',
      amountCents: 50_000,
      customerName: 'Maria Souza',
      installmentNumber: 2,
      installmentCount: 3,
    })

    const r = await app.inject({ method: 'GET', url: '/contas-a-receber/exportar' })

    expect(r.statusCode).toBe(200)
    expect(r.headers['content-disposition']).toContain('contas-a-receber.csv')
    expect(r.body).toContain('Maria Souza')
    expect(r.body).toContain('2/3')
  })

  it('sem cliente identificado, mas nao em branco', async () => {
    const c = await buildApp()
    app = c.app
    c.receivables.adicionar('empresa-1', { dueDate: '2020-01-01', customerName: null })

    const r = await app.inject({ method: 'GET', url: '/contas-a-receber/exportar' })

    expect(r.body).toContain('Cliente não identificado')
  })

  it('pdf de verdade', async () => {
    const c = await buildApp()
    app = c.app
    c.receivables.adicionar('empresa-1', { dueDate: '2020-01-01' })

    const r = await app.inject({ method: 'GET', url: '/contas-a-receber/exportar?formato=pdf' })

    expect(r.headers['content-type']).toBe('application/pdf')
    expect(r.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})

describe('corrigir e cancelar recebivel avulso — NR-150', () => {
  async function comRecebivel(principal: AuthenticatedPrincipal = PRINCIPAL) {
    const c = await buildApp(principal)
    app = c.app
    const [r] = await c.receivablesUow.transaction('empresa-1', async (tx) => [
      await tx.insert({
        companyId: 'empresa-1',
        description: 'Aluguel',
        amountCents: 80_000,
        dueDate: '2026-09-15',
        customerId: null,
        accountId: null,
        isCustomerDebt: false,
        createdBy: 'usuario-1',
        createdAt: new Date('2026-09-02T12:00:00.000Z'),
      }),
    ])
    return { ...c, id: r!.id }
  }

  it('PATCH corrige e devolve o titulo', async () => {
    const { id } = await comRecebivel()

    const r = await app.inject({
      method: 'PATCH',
      url: `/contas-a-receber/${id}`,
      payload: { amountCents: 90_000 },
    })

    expect(r.statusCode).toBe(200)
    expect(r.json().amountCents).toBe(90_000)
  })

  it('PATCH vazio e 400 — nao diz o que corrigir', async () => {
    const { id } = await comRecebivel()

    const r = await app.inject({ method: 'PATCH', url: `/contas-a-receber/${id}`, payload: {} })

    expect(r.statusCode).toBe(400)
  })

  it('cancelar pede motivo', async () => {
    const { id } = await comRecebivel()

    const sem = await app.inject({
      method: 'POST',
      url: `/contas-a-receber/${id}/cancelar`,
      payload: {},
    })
    const com = await app.inject({
      method: 'POST',
      url: `/contas-a-receber/${id}/cancelar`,
      payload: { reason: 'Lancei em dobro' },
    })

    expect(sem.statusCode).toBe(400)
    expect(com.statusCode).toBe(200)
    expect(com.json().status).toBe('cancelled')
  })

  it('com recebimento registrado e 409', async () => {
    const { id, receivablesUow } = await comRecebivel()
    receivablesUow.simularBaixa(id, 10_000)

    const r = await app.inject({
      method: 'PATCH',
      url: `/contas-a-receber/${id}`,
      payload: { amountCents: 1 },
    })

    expect(r.statusCode).toBe(409)
  })

  it('titulo que nao existe e 404', async () => {
    await comRecebivel()

    const r = await app.inject({
      method: 'POST',
      url: '/contas-a-receber/nao-existe/cancelar',
      payload: { reason: 'Lancei em dobro' },
    })

    expect(r.statusCode).toBe(404)
  })

  it('accountant nao corrige — e escrita', async () => {
    const { id } = await comRecebivel({ ...PRINCIPAL, role: 'accountant' })

    const r = await app.inject({
      method: 'PATCH',
      url: `/contas-a-receber/${id}`,
      payload: { amountCents: 1 },
    })

    expect(r.statusCode).toBe(403)
  })
})
