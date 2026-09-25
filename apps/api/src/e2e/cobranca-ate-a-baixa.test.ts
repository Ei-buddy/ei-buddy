import { randomUUID } from 'node:crypto'
import { referenciaDaCobranca } from '@na-regua/core'
import {
  createCustomerChargeRepository,
  createSettlementUnitOfWork,
  createWebhookInbox,
  getClient,
  migrate,
  withTenant,
} from '@na-regua/db'
import { criarGatewayAsaas } from '@na-regua/payments'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { registerWebhookRoutes } from '../routes/webhooks.js'

/**
 * Fluxo 3 do E2E — cobranca a distancia ate a baixa. NR-049, RF-068.
 *
 * `docs/engenharia/testes.md` listava este fluxo como impedido: "nenhuma rota
 * existe na api". Agora existe, e este arquivo e o fluxo.
 *
 * ## O que atravessa de verdade
 *
 * HTTP -> rota -> `core` -> `db` -> Postgres, com os repositorios REAIS: a
 * unidade de trabalho de baixas, o registro da cobranca e a caixa de entrada
 * de webhooks. O que o teste prova e que o dinheiro que entra vira titulo
 * baixado, e nao que uma funcao foi chamada.
 *
 * ## Por que o adapter e montado aqui, e nao vem da composicao
 *
 * `buildWebhookDeps()` so monta o gateway com `SECRETS_KEY`, que a CI nao
 * define — pela composicao real, esta suite provaria apenas o 503.
 *
 * Entao o adapter REAL e construido no teste. Cabe porque `readWebhook` e
 * local: compara o token e traduz o corpo, sem tocar a rede.
 *
 * ## A metade que continua de fora
 *
 * O ENVIO pelo WhatsApp. O adapter real e a NR-046, e hoje o remetente e um
 * falso: incluir o envio faria a suite exercitar mock, que e exatamente o que
 * `testes.md` manda evitar.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('cobranca a distancia ate a baixa — NR-049', () => {
  /* `getClient` devolve o cliente do driver; `apps/api` nao depende de
     `postgres` direto, e nao deve. */
  let sql: ReturnType<typeof getClient>
  let app: FastifyInstance
  let empresa: string
  let cliente: string
  let tituloUm: string
  let tituloDois: string
  let referencia: string

  const AGORA = '2026-09-20T15:00:00.000Z'
  const TOKEN = 'token-de-aviso-da-loja'

  /*
   * O leitor de webhook e o do adapter REAL, e nao o do falso.
   *
   * A primeira versao usava o falso e os testes de reentrega passaram a medir
   * ELE: o falso deduplica por `eventId` por conta propria, coisa que o Asaas
   * nao faz. O resultado era um teste que aprovava a protecao errada — a do
   * duble, e nao a caixa de entrada que este arquivo existe para exercitar.
   *
   * O adapter real cabe aqui porque `readWebhook` e local: compara o token e
   * traduz o corpo, sem tocar a rede. `credenciais` e `fetch` existem para os
   * outros metodos, que este teste nao chama.
   */
  const leitor = criarGatewayAsaas({
    ambiente: 'sandbox',
    credenciais: { apiKeyDaEmpresa: async () => undefined },
    webhookSecret: TOKEN,
    fetch: async () => new Response('{}'),
  })

  async function criarRecebivel(descricao: string, centavos: number): Promise<string> {
    const [linha] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO receivables
          (company_id, customer_id, origin, description, amount_cents,
           net_amount_cents, due_date)
        VALUES (${empresa}, ${cliente}, ${'manual'}, ${descricao}, ${centavos},
                ${centavos}, ${'2026-09-01'})
        RETURNING id
      `,
    )
    return linha!.id
  }

  function saldoDe(id: string) {
    return withTenant(
      sql,
      empresa,
      (tx) => tx<{ settled_amount_cents: string; status: string }[]>`
        SELECT settled_amount_cents, status FROM receivables WHERE id = ${id}
      `,
    )
  }

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    sql = getClient(DATABASE_URL!)

    empresa = randomUUID()
    const cnpj = `77${String(Date.now()).slice(-12)}`
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, ${'Mercearia do Fluxo 3'}, ${cnpj},
                ${'contato@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )

    const [linha] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO customers (company_id, name, phone)
        VALUES (${empresa}, ${'Dona Marta'}, ${'41988887777'})
        RETURNING id
      `,
    )
    cliente = linha!.id

    tituloUm = await criarRecebivel('Fiado de agosto', 5_000)
    tituloDois = await criarRecebivel('Fiado de setembro', 3_000)

    /* A cobranca, pelo repositorio REAL — o mesmo caminho que
       `sendCustomerCharge` percorre depois de criar o link. */
    referencia = referenciaDaCobranca(empresa, `req-${Date.now()}`)
    await createCustomerChargeRepository(sql).registrar({
      companyId: empresa,
      customerId: cliente,
      externalReference: referencia,
      amountCents: 8_000,
      providerLinkId: 'link_e2e',
      checkoutUrl: 'https://fake.payments.local/pay/link_e2e',
      titulos: [
        { receivableId: tituloUm, amountCents: 5_000 },
        { receivableId: tituloDois, amountCents: 3_000 },
      ],
      createdAt: new Date(AGORA),
    })

    app = Fastify({ logger: false })
    registerErrorHandler(app)
    registerWebhookRoutes(app, {
      cobranca: {
        uow: createSettlementUnitOfWork(sql),
        charges: createCustomerChargeRepository(sql),
        inbox: createWebhookInbox(sql),
        readWebhook: (corpo, assinatura) => leitor.readWebhook(corpo, assinatura),
      },
    })
    await app.ready()
  }, 90_000)

  afterAll(async () => {
    await app?.close()
  })

  /* Ids de aviso proprios desta rodada. A caixa de entrada guarda os ids ja
     processados, e com ids fixos a segunda rodada no mesmo banco via tudo
     como "repetido" — o teste so passava com o banco zerado. */
  const rodada = randomUUID().slice(0, 8)
  const evento = (n: number) => `evt_e2e_${rodada}_${n}`

  /* O corpo como o Asaas manda: `event` em caixa alta e valor DECIMAL. */
  const avisoDePagamento = (eventId: string) =>
    JSON.stringify({
      id: eventId,
      event: 'PAYMENT_RECEIVED',
      dateCreated: AGORA,
      payment: {
        id: 'pay_e2e',
        value: 80,
        externalReference: referencia,
      },
    })

  const postar = (corpo: string) =>
    app.inject({
      method: 'POST',
      url: '/webhooks/asaas/lojas',
      headers: {
        'content-type': 'application/json',
        'asaas-access-token': TOKEN,
      },
      payload: corpo,
    })

  it('o pagamento do link baixa os dois titulos, no banco', async () => {
    const r = await postar(avisoDePagamento(evento(1)))

    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body)).toMatchObject({ status: 'settled', titulosBaixados: 2 })

    /* A prova esta no Postgres, e nao no corpo da resposta. */
    const [um] = await saldoDe(tituloUm)
    const [dois] = await saldoDe(tituloDois)
    expect([Number(um?.settled_amount_cents), um?.status]).toEqual([5_000, 'settled'])
    expect([Number(dois?.settled_amount_cents), dois?.status]).toEqual([3_000, 'settled'])
  })

  it('a reentrega do mesmo aviso nao baixa de novo', async () => {
    const r = await postar(avisoDePagamento(evento(1)))

    expect(JSON.parse(r.body)).toMatchObject({ repetido: true })

    /* O provedor reentrega ate cinco vezes. Sem a caixa de entrada, o titulo
       de R$ 50,00 apareceria com R$ 100,00 baixados. */
    const [um] = await saldoDe(tituloUm)
    expect(Number(um?.settled_amount_cents)).toBe(5_000)
  })

  it('um aviso NOVO para a mesma cobranca tambem nao baixa de novo', async () => {
    const r = await postar(avisoDePagamento(evento(2)))

    /* A caixa de entrada nao pega este: o id e outro. Quem pega e o estado da
       cobranca, que ja saiu de `pending`. */
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body)).toMatchObject({ status: 'ignored' })

    const [um] = await saldoDe(tituloUm)
    expect(Number(um?.settled_amount_cents)).toBe(5_000)
  })

  it('token errado nao baixa nada, e responde 401', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/asaas/lojas',
      headers: { 'content-type': 'application/json', 'asaas-access-token': 'token-forjado' },
      payload: avisoDePagamento(evento(3)),
    })

    /* Sem isto, qualquer um postaria "pagamento recebido" e o titulo baixaria
       sozinho. */
    expect(r.statusCode).toBe(401)
  })
})
