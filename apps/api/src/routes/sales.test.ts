import type { CreateSaleInput } from '@na-regua/contracts'
import type {
  CompanySettingsRepository,
  RegisteredSale,
  SaleHistoryRepository,
  SaleTransaction,
  UnitOfWork,
  VendaDoHistorico,
} from '@na-regua/core'
import { createDefaultSaleSettings } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerSaleRoutes, type SaleRouteDeps } from './sales.js'

/**
 * Historico em memoria — a leitura das vendas.
 *
 * Guarda o que recebeu e devolve pagina e total como o repositorio de verdade:
 * um falso que devolvesse tudo, ignorando `offset` e `limite`, deixaria passar
 * um SQL sem paginacao — e o defeito so apareceria na loja com historico
 * grande, que e a que menos pode travar.
 */
function historicoEmMemoria(vendas: VendaDoHistorico[] = []): SaleHistoryRepository {
  return {
    list: async (_companyId, filtro) => {
      const validas = vendas.filter((v) => v.status !== 'cancelled')
      return {
        vendas: vendas.slice(filtro.offset, filtro.offset + filtro.limite),
        total: vendas.length,
        /* Cancelada fica FORA dos totais e DENTRO da lista, como no banco. */
        resumo: {
          salesCount: validas.length,
          grossCents: validas.reduce((a, v) => a + v.grossAmountCents, 0),
          netCents: validas.reduce((a, v) => a + v.netAmountCents, 0),
          cardFeeCents: validas.reduce((a, v) => a + v.cardFeeAmountCents, 0),
        },
      }
    },
    findById: async (_companyId, saleId) => vendas.find((v) => v.id === saleId),
  }
}

/**
 * Sobe um Fastify de verdade com `app.inject`: o que esta rota promete e um par
 * status + corpo, e isso so aparece passando pelo ciclo de requisicao.
 *
 * O repositorio e em memoria — a rota nao precisa de Postgres para provar que
 * traduz HTTP corretamente, e um teste que precisasse so rodaria na CI.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
}

/** Unidade de trabalho minima, com idempotencia de verdade. */
function unitOfWorkEmMemoria() {
  const porChave = new Map<string, RegisteredSale>()
  let sequencia = 0

  const uow: UnitOfWork = {
    transaction: async (_companyId, fn) => {
      const tx: SaleTransaction = {
        /* A trilha entra na transacao desde a NR-087. Aqui ela nao e
           inspecionada: quem testa a ROTA testa status e corpo. */
        record: async (entrada) => ({
          id: 'aud-1',
          entity: entrada.entity,
          entityId: entrada.entityId,
          action: entrada.action,
          actorId: entrada.actorId,
          channel: entrada.channel,
          occurredAt: entrada.occurredAt.toISOString(),
          before: entrada.before,
          after: entrada.after,
        }),
        products: {
          findManyByIds: async (ids) =>
            ids.map((id) => ({
              id,
              description: `Produto ${id}`,
              unitOfMeasure: 'un',
              salePriceCents: 1_000,
              costPriceCents: 600,
              stockQuantity: 10,
              taxRate: null,
            })),
        },
        insertSale: async (sale) => {
          sequencia += 1
          const gravada: RegisteredSale = {
            id: `venda-${sequencia}`,
            number: sequencia,
            grossAmountCents: 1_000,
            costAmountCents: 600,
            taxAmountCents: 0,
            cardFeeAmountCents: 0,
            netAmountCents: 1_000,
            changeCents: 0,
            createdAt: sale.createdAt.toISOString(),
          }
          if (sale.idempotencyKey !== undefined) porChave.set(sale.idempotencyKey, gravada)
          return gravada
        },
        decreaseStock: async () => undefined,
        findByIdempotencyKey: async (chave) => porChave.get(chave),
      }
      return fn(tx)
    },
  }

  return uow
}

/* `principal` e `AuthenticatedPrincipal | null`, e nao opcional: passar
   `undefined` acionaria o valor padrao do parametro e o teste de 401 anexaria
   o principal do mesmo jeito. `null` nao tem esse comportamento. */
function buildApp(
  over: Partial<SaleRouteDeps> = {},
  principal: AuthenticatedPrincipal | null = PRINCIPAL,
): FastifyInstance {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)

  /* No lugar da autenticacao, que e a NR-014. */
  app.addHook('onRequest', async (request) => {
    if (principal !== null) request.principal = principal
  })

  const deps: SaleRouteDeps = {
    unitOfWork: unitOfWorkEmMemoria(),
    settings: createDefaultSaleSettings(),
    /* O historico e leitura e nao participa do fechamento; um falso vazio
       basta para os testes de escrita, e os de leitura o sobrescrevem. */
    history: historicoEmMemoria(),
    /* O cancelamento tem suite propria em `core`; aqui so precisa existir para
       o tipo fechar. Quem testar a rota de cancelar sobrescreve. */
    uow: {
      transaction: async () => {
        throw new Error('nao executa neste teste')
      },
    },
    /* A devolucao tambem tem suite propria em `core` e no E2E. */
    returns: {
      transaction: async () => {
        throw new Error('nao executa neste teste')
      },
    },
    ...over,
  }

  registerSaleRoutes(app, deps)
  return app
}

const venda: CreateSaleInput = {
  items: [{ productId: 'prod-1', quantity: 1, unitPriceCents: 1_000 }],
  payments: [{ method: 'cash', amountCents: 1_000 }],
}

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
})

describe('POST /sales — RF-036', () => {
  it('registra a venda e responde 201', async () => {
    app = buildApp()

    const r = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { 'idempotency-key': 'chave-1' },
      payload: venda,
    })

    expect(r.statusCode).toBe(201)
    expect(r.json().sale.id).toBeTruthy()
  })

  it('devolve os avisos de estoque junto — RF-028', async () => {
    app = buildApp()

    const r = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { 'idempotency-key': 'chave-1' },
      payload: venda,
    })

    expect(r.json()).toHaveProperty('stockWarnings')
  })
})

/**
 * O coracao da tarefa. O PDV com internet ruim reenvia, e sem a chave o segundo
 * envio vira uma segunda venda, com segundo estoque baixado e segundo
 * recebivel.
 */
describe('idempotencia — RNF-043', () => {
  it('exige o cabecalho, com 400', async () => {
    app = buildApp()

    const r = await app.inject({ method: 'POST', url: '/sales', payload: venda })

    expect(r.statusCode).toBe(400)
    expect(r.json().error.message).toContain('idempotency-key')
  })

  it('o reenvio com a mesma chave devolve a MESMA venda', async () => {
    app = buildApp()
    const enviar = () =>
      app.inject({
        method: 'POST',
        url: '/sales',
        headers: { 'idempotency-key': 'chave-1' },
        payload: venda,
      })

    const primeira = await enviar()
    const segunda = await enviar()

    expect(segunda.json().sale.id).toBe(primeira.json().sale.id)
  })

  /* 201 diz "criei agora", 200 diz "isto ja existia". Responder 201 sempre
     faria um integrador contar duas vendas onde houve uma. */
  it('o reenvio responde 200, nao 201', async () => {
    app = buildApp()
    const enviar = () =>
      app.inject({
        method: 'POST',
        url: '/sales',
        headers: { 'idempotency-key': 'chave-1' },
        payload: venda,
      })

    expect((await enviar()).statusCode).toBe(201)
    const segunda = await enviar()
    expect(segunda.statusCode).toBe(200)
    expect(segunda.json().replayed).toBe(true)
  })

  it('chave diferente registra venda diferente', async () => {
    app = buildApp()
    const enviar = (chave: string) =>
      app.inject({
        method: 'POST',
        url: '/sales',
        headers: { 'idempotency-key': chave },
        payload: venda,
      })

    const a = await enviar('chave-1')
    const b = await enviar('chave-2')

    expect(b.json().sale.id).not.toBe(a.json().sale.id)
  })
})

describe('validacao e autorizacao', () => {
  it('corpo invalido responde 400 com o campo', async () => {
    app = buildApp()

    const r = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { 'idempotency-key': 'chave-1' },
      payload: { items: [], payments: [] },
    })

    expect(r.statusCode).toBe(400)
  })

  it('campo desconhecido e recusado — o schema e strict', async () => {
    app = buildApp()

    const r = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { 'idempotency-key': 'chave-1' },
      payload: { ...venda, desconto: 999 },
    })

    expect(r.statusCode).toBe(400)
  })

  /* Enquanto a NR-014 nao existe, nada popula o principal e toda chamada cai
     aqui. 401 e melhor que um contexto inventado. */
  it('sem sessao responde 401, nao 500', async () => {
    app = buildApp({}, null)

    const r = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { 'idempotency-key': 'chave-1' },
      payload: venda,
    })

    expect(r.statusCode).toBe(401)
  })

  /* A verificacao de papel vive em `core`, e a rota so traduz: e o que faz o
     canal WhatsApp aplicar a mesma regra. */
  it('accountant recebe 403 — somente leitura', async () => {
    app = buildApp({}, { ...PRINCIPAL, role: 'accountant' })

    const r = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { 'idempotency-key': 'chave-1' },
      payload: venda,
    })

    expect(r.statusCode).toBe(403)
  })
})

describe('configuracao padrao de venda', () => {
  const settings: CompanySettingsRepository = createDefaultSaleSettings()

  it('owner nao tem teto de desconto', async () => {
    const s = await settings.forSale('empresa-1', 'owner')
    expect(s.discountPolicy.maxDiscountRate).toBe(100)
  })

  it('staff tem teto de 10 pontos', async () => {
    const s = await settings.forSale('empresa-1', 'staff')
    expect(s.discountPolicy.maxDiscountRate).toBe(10)
  })

  /* Papel novo que ninguem mapeou nao pode nascer podendo dar desconto. */
  it('papel desconhecido cai em zero, nao no teto do owner', async () => {
    const s = await settings.forSale('empresa-1', 'papel-que-nao-existe')
    expect(s.discountPolicy.maxDiscountRate).toBe(0)
  })
})

describe('historico de vendas — NR-027, US-021', () => {
  const venda = (over: Partial<VendaDoHistorico> = {}): VendaDoHistorico => ({
    id: 'venda-1',
    number: 1,
    soldAt: '2026-09-06T15:00:00.000Z',
    customerId: null,
    customerName: null,
    status: 'open',
    grossAmountCents: 1990,
    discountCents: 0,
    netAmountCents: 1990,
    taxAmountCents: 0,
    cardFeeAmountCents: 0,
    returnedAmountCents: 0,
    items: [
      {
        productId: null,
        description: 'Cafe',
        quantity: 1,
        returnedQuantity: 0,
        unitPriceCents: 1990,
        totalCents: 1990,
      },
    ],
    payments: [{ method: 'cash', amountCents: 1990, installments: null }],
    invoiceNumber: null,
    invoiceAccessKey: null,
    ...over,
  })

  it('lista sem periodo — a tela abre mostrando as mais recentes', async () => {
    app = buildApp({ history: historicoEmMemoria([venda()]) })

    const r = await app.inject({ method: 'GET', url: '/sales' })

    /*
     * Sem `from`/`to`. Diferente do DRE e dos relatorios, onde o periodo e a
     * propria pergunta: aqui exigi-lo faria a tela pedir duas datas antes de
     * mostrar qualquer coisa.
     */
    expect(r.statusCode).toBe(200)
    expect(r.json().sales).toHaveLength(1)
    expect(r.json().page).toBe(1)
    expect(r.json().pageSize).toBe(20)
  })

  it('devolve o total do historico, e nao o tamanho da pagina', async () => {
    const muitas = Array.from({ length: 30 }, (_, i) => venda({ id: `v-${i}`, number: i + 1 }))
    app = buildApp({ history: historicoEmMemoria(muitas) })

    const r = await app.inject({ method: 'GET', url: '/sales?pageSize=5' })

    expect(r.json().sales).toHaveLength(5)
    /* 30, e nao 5: e o que faz a tela dizer "5 de 30" e oferecer a proxima. */
    expect(r.json().total).toBe(30)
  })

  it('converte pagina e tamanho, que chegam como TEXTO na query', async () => {
    const muitas = Array.from({ length: 30 }, (_, i) => venda({ id: `v-${i}`, number: i + 1 }))
    app = buildApp({ history: historicoEmMemoria(muitas) })

    const r = await app.inject({ method: 'GET', url: '/sales?page=2&pageSize=5' })

    expect(r.json().page).toBe(2)
    expect(r.json().sales.map((v: { id: string }) => v.id)).toEqual([
      'v-5',
      'v-6',
      'v-7',
      'v-8',
      'v-9',
    ])
  })

  it('recusa periodo invertido', async () => {
    app = buildApp()

    const r = await app.inject({ method: 'GET', url: '/sales?from=2026-03-01&to=2026-01-31' })

    expect(r.statusCode).toBe(400)
  })

  it('devolve uma venda inteira, com itens e pagamentos', async () => {
    app = buildApp({ history: historicoEmMemoria([venda()]) })

    const r = await app.inject({ method: 'GET', url: '/sales/venda-1' })

    expect(r.statusCode).toBe(200)
    expect(r.json().items).toHaveLength(1)
    expect(r.json().payments[0]).toMatchObject({ method: 'cash', amountCents: 1990 })
  })

  it('venda que nao existe volta 404, e nao corpo vazio', async () => {
    app = buildApp({ history: historicoEmMemoria([]) })

    const r = await app.inject({ method: 'GET', url: '/sales/nao-existe' })

    /* Acesso a RECURSO: "esta venda nao existe" e diferente de "esta busca nao
       achou nada". E venda de outra empresa cai no mesmo 404 — um 403
       confirmaria que ela existe em algum lugar. */
    expect(r.statusCode).toBe(404)
  })

  it('sem sessao, o historico responde 401', async () => {
    app = buildApp({ history: historicoEmMemoria([venda()]) }, null)

    const r = await app.inject({ method: 'GET', url: '/sales' })

    expect(r.statusCode).toBe(401)
  })
})
