import { agentReplySchema } from '@na-regua/contracts'
import { createAgentRuntime, FakeLlm, type AgentUseCases } from '@na-regua/agent'
import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerAgentRoutes } from './agent.js'

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
}

const useCases: AgentUseCases = {
  listSales: async () => ({
    sales: [],
    total: 0,
    page: 1,
    pageSize: 20,
    summary: {
      salesCount: 1,
      grossCents: 10_000,
      netCents: 10_000,
      cardFeeCents: 0,
      netAfterFeesCents: 10_000,
      averageTicketCents: 10_000,
    },
  }),
  listReceivables: async () => ({
    grupos: [],
    totalCents: 0,
    temVencidas: false,
  }),
  registerCustomer: async () => {
    throw new Error('nao deveria cadastrar neste teste')
  },
  registerSale: async () => {
    throw new Error('nao deveria vender neste teste')
  },
  searchProducts: async () => [],
  revenueByMonth: async () => ({
    from: '2026-09-01',
    to: '2026-09-30',
    months: [],
    totalNetCents: 0,
  }),
  buildDre: async () => {
    throw new Error('nao deveria montar DRE neste teste')
  },
  sendCustomerCharge: async () => {
    throw new Error('nao deveria cobrar neste teste')
  },
}

function buildApp(
  principal: AuthenticatedPrincipal | null = PRINCIPAL,
  runtime = createAgentRuntime({ useCases }),
): FastifyInstance {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  app.addHook('onRequest', async (request) => {
    if (principal !== null) request.principal = principal
  })
  registerAgentRoutes(app, { runtime })
  return app
}

describe('POST /agent/messages', () => {
  it('responde consulta autenticada sem WhatsApp', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?' },
    })
    expect(res.statusCode).toBe(200)
    const corpo = agentReplySchema.parse(JSON.parse(res.body))
    expect(corpo.kind).toBe('answer')
    expect(corpo.text).toContain('1 venda')
    await app.close()
  })

  it('intencao desconhecida lista capacidades, sem inventar — RF-097', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'me conta uma piada' },
    })
    expect(res.statusCode).toBe(200)
    const corpo = agentReplySchema.parse(JSON.parse(res.body))
    expect(corpo.kind).toBe('unknown')
    expect(corpo.text).toContain('list_sales')
    expect(corpo.text).toContain('create_sale')
    expect(corpo.text).not.toMatch(/US-065|estoque|em breve/i)
    await app.close()
  })

  it('consulta fora do catalogo (estoque) tambem so lista capacidades', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto tem de camiseta?' },
    })
    expect(res.statusCode).toBe(200)
    const corpo = agentReplySchema.parse(JSON.parse(res.body))
    expect(corpo.kind).toBe('unknown')
    expect(corpo.text).toContain('list_sales')
    expect(corpo.text).not.toMatch(/US-065|estoque|em breve/i)
    await app.close()
  })

  it('recusa sem sessao', async () => {
    const app = buildApp(null)
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('recusa mensagem vazia', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: '   ' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('recusa companyId no body — tenant vem so da sessao da fixture', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?', companyId: 'outra-loja' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('recusa peer e channel no body — schema continua so text (NR-121)', async () => {
    const app = buildApp()
    const comPeer = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?', peer: '5511999000001' },
    })
    expect(comPeer.statusCode).toBe(400)

    const comCanal = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?', channel: 'whatsapp' },
    })
    expect(comCanal.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /agent/messages — confirmacao (RF-103, US1)', () => {
  const agora = new Date('2026-09-11T15:00:00.000Z')
  const pedidoCadastro = 'cadastra o Joao, 11 98888-7777'
  const argsCadastro = { name: 'Joao', phone: '11 98888-7777' }
  const fraseVenda = 'venda pro Joao: 2 camisetas M a 49,90, pagou no Pix'
  const argsVenda = {
    items: [{ productId: 'p-azul', quantity: 2, unitPriceCents: 4_990 }],
    payments: [{ method: 'pix' as const, amountCents: 9_980 }],
  }

  function clienteSaida(name: string, phone: string | null) {
    return {
      id: 'cli-1',
      name,
      document: null,
      phone,
      email: null,
      notes: null,
      walletLimitCents: 0,
      walletBalanceCents: 0,
      address: {
        zipCode: null,
        street: null,
        number: null,
        complement: null,
        district: null,
        city: null,
        state: null,
      },
      createdAt: agora.toISOString(),
      anonymizedAt: null,
    }
  }

  function vendaSaida() {
    return {
      sale: {
        id: 's1',
        number: 1042,
        grossAmountCents: 9_980,
        costAmountCents: 4_000,
        taxAmountCents: 0,
        cardFeeAmountCents: 0,
        netAmountCents: 9_980,
        changeCents: 0,
        createdAt: agora.toISOString(),
      },
      replayed: false,
      stockWarnings: [],
    }
  }

  function buildAppConfirmacao(over: Partial<AgentUseCases>, llm: FakeLlm): FastifyInstance {
    return buildApp(PRINCIPAL, createAgentRuntime({ useCases: { ...useCases, ...over }, llm }))
  }

  it('create_customer pede confirmacao e so grava no sim', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script(pedidoCadastro, { type: 'tool', name: 'create_customer', args: argsCadastro })
    const app = buildAppConfirmacao(
      {
        registerCustomer: async (_ctx, input) => {
          chamadas += 1
          return {
            status: 'created',
            customer: clienteSaida(input.name, input.phone ?? null),
          }
        },
      },
      llm,
    )

    const proposta = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: pedidoCadastro },
    })
    expect(proposta.statusCode).toBe(200)
    const corpoProposta = agentReplySchema.parse(JSON.parse(proposta.body))
    expect(corpoProposta.kind).toBe('confirmation')
    expect(corpoProposta.text).toBe('Cadastrar cliente Joao, telefone 11988887777. Confirma?')
    expect(chamadas).toBe(0)

    const sim = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'sim' },
    })
    expect(sim.statusCode).toBe(200)
    const corpoSim = agentReplySchema.parse(JSON.parse(sim.body))
    expect(corpoSim.kind).toBe('answer')
    expect(corpoSim.text).toBe('Cliente Joao cadastrado.')
    expect(chamadas).toBe(1)
    await app.close()
  })

  it('create_sale pede confirmacao e sem sim nao grava', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script(fraseVenda, { type: 'tool', name: 'create_sale', args: argsVenda })
    const app = buildAppConfirmacao(
      {
        registerSale: async () => {
          chamadas += 1
          return vendaSaida()
        },
      },
      llm,
    )

    const proposta = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: fraseVenda },
    })
    expect(proposta.statusCode).toBe(200)
    const corpo = agentReplySchema.parse(JSON.parse(proposta.body))
    expect(corpo.kind).toBe('confirmation')
    expect(corpo.text).toMatch(/Confirma\?/)
    expect(chamadas).toBe(0)
    await app.close()
  })

  it('create_sale no sim grava uma vez; nao recusa sem gravar', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script(fraseVenda, { type: 'tool', name: 'create_sale', args: argsVenda })
    const app = buildAppConfirmacao(
      {
        registerSale: async () => {
          chamadas += 1
          return vendaSaida()
        },
      },
      llm,
    )

    const proposta = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: fraseVenda },
    })
    expect(agentReplySchema.parse(JSON.parse(proposta.body)).kind).toBe('confirmation')
    expect(chamadas).toBe(0)

    const sim = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'sim' },
    })
    const corpoSim = agentReplySchema.parse(JSON.parse(sim.body))
    expect(sim.statusCode).toBe(200)
    expect(corpoSim.kind).toBe('answer')
    expect(corpoSim.text).toContain('#1042')
    expect(chamadas).toBe(1)
    await app.close()

    let recusas = 0
    const llmRecusa = new FakeLlm()
    llmRecusa.script(fraseVenda, { type: 'tool', name: 'create_sale', args: argsVenda })
    const appRecusa = buildAppConfirmacao(
      {
        registerSale: async () => {
          recusas += 1
          return vendaSaida()
        },
      },
      llmRecusa,
    )
    await appRecusa.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: fraseVenda },
    })
    const nao = await appRecusa.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'nao' },
    })
    const corpoNao = agentReplySchema.parse(JSON.parse(nao.body))
    expect(nao.statusCode).toBe(200)
    expect(corpoNao.kind).toBe('answer')
    expect(corpoNao.text).toMatch(/Cancelado/)
    expect(recusas).toBe(0)
    await appRecusa.close()
  })
})

/**
 * Sem runtime configurado — ADR-0010.
 *
 * O ponto nao e o 503: e que exista resposta. Enquanto a api recusava subir
 * por falta de chave de IA, isto aqui era um processo em laco de reinicio e
 * nenhuma outra rota respondendo.
 */
describe('POST /agent/messages sem runtime', () => {
  function buildAppSemRuntime(motivo?: string): FastifyInstance {
    const app = Fastify({ logger: false })
    registerErrorHandler(app)
    app.addHook('onRequest', async (request) => {
      request.principal = PRINCIPAL
    })
    registerAgentRoutes(app, null, motivo)
    return app
  }

  it('responde 503 com motivo, em vez de 404', async () => {
    const app = buildAppSemRuntime()
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?' },
    })

    expect(res.statusCode).toBe(503)
    const corpo = JSON.parse(res.body) as { error: { code: string; message: string } }
    expect(corpo.error.code).toBe('UNAVAILABLE')
    expect(corpo.error.message).toMatch(/indisponivel/i)
    expect(corpo.error.message).toMatch(/harness/i)
    expect(corpo.error.message).toMatch(/fixture/i)
    await app.close()
  })

  it('propaga o motivo de harness off / fake em prod (FR-001b)', async () => {
    const app = buildAppSemRuntime(
      'Harness do assistente desligado em producao (FR-001b). ' +
        'Defina AGENT_HARNESS=1 so para staging de engenharia.',
    )
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?' },
    })

    expect(res.statusCode).toBe(503)
    const corpo = JSON.parse(res.body) as { error: { code: string; message: string } }
    expect(corpo.error.code).toBe('UNAVAILABLE')
    expect(corpo.error.message).toMatch(/FR-001b/)
    expect(corpo.error.message).toMatch(/AGENT_HARNESS=1/)
    await app.close()
  })
})
