import { agentReplySchema } from '@na-regua/contracts'
import { createAgentRuntime, FRASE_PEDIDO_DE_TEXTO } from '@na-regua/agent'
import {
  criarLojaDeTeste,
  roteiroDoModelo,
  type EtapaRoteirizada,
} from '@na-regua/agent/test-support'
import Fastify, { type FastifyInstance } from 'fastify'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerAgentRoutes } from './agent.js'

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'emp-A',
  userId: 'user-A',
  role: 'owner',
}

function runtimeCom(etapas: readonly EtapaRoteirizada[]) {
  const { modelo, chamadas } = roteiroDoModelo(etapas)
  const loja = criarLojaDeTeste()
  return { runtime: createAgentRuntime({ model: modelo, useCases: loja.useCases }), chamadas, loja }
}

function buildApp(
  principal: AuthenticatedPrincipal | null = PRINCIPAL,
  runtime = runtimeCom([{ texto: 'Oi!' }]).runtime,
): FastifyInstance {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  app.addHook('onRequest', async (request) => {
    if (principal !== null) request.principal = principal
  })
  registerAgentRoutes(app, { runtime })
  return app
}

async function enviar(app: FastifyInstance, payload: unknown) {
  return app.inject({ method: 'POST', url: '/agent/messages', payload: payload as never })
}

describe('POST /agent/messages', () => {
  it('responde consulta autenticada sem WhatsApp, redigida a partir do resultado', async () => {
    const { runtime, chamadas } = runtimeCom([
      { tool: 'check_stock', args: { query: 'café' } },
      { texto: 'Tem café em grãos a R$ 25,00.' },
    ])
    const app = buildApp(PRINCIPAL, runtime)
    const res = await enviar(app, { text: 'quanto tem de café?' })

    expect(res.statusCode).toBe(200)
    const corpo = agentReplySchema.parse(JSON.parse(res.body))
    expect(corpo).toEqual({ kind: 'answer', text: 'Tem café em grãos a R$ 25,00.' })
    expect(JSON.stringify(chamadas[1]?.prompt)).toMatch(/R\$\s?25,00/)
    await app.close()
  })

  it('corpo so com imagem recebe o pedido de texto, sem chamar o modelo — US7', async () => {
    const { runtime, chamadas } = runtimeCom([{ texto: 'nao deveria responder' }])
    const app = buildApp(PRINCIPAL, runtime)
    const res = await enviar(app, {
      image: { mimeType: 'image/jpeg', dataBase64: Buffer.from('foto').toString('base64') },
    })
    expect(res.statusCode).toBe(200)
    const corpo = agentReplySchema.parse(JSON.parse(res.body))
    expect(corpo).toEqual({ kind: 'answer', text: FRASE_PEDIDO_DE_TEXTO })
    expect(chamadas).toHaveLength(0)
    await app.close()
  })

  it('recusa sem sessao', async () => {
    const app = buildApp(null)
    const res = await enviar(app, { text: 'quanto vendi hoje?' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('recusa mensagem vazia', async () => {
    const app = buildApp()
    const res = await enviar(app, { text: '   ' })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('recusa companyId no body — tenant vem so da sessao da fixture', async () => {
    const app = buildApp()
    const res = await enviar(app, { text: 'quanto vendi hoje?', companyId: 'outra-loja' })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('recusa peer e channel no body — schema continua so text (NR-121)', async () => {
    const app = buildApp()
    expect((await enviar(app, { text: 'oi', peer: '5511999000001' })).statusCode).toBe(400)
    expect((await enviar(app, { text: 'oi', channel: 'whatsapp' })).statusCode).toBe(400)
    await app.close()
  })

  it('devolve o texto do modelo numa string so, sem formatar para o WhatsApp', async () => {
    const texto = '**Total**\n- a\n- b'
    const app = buildApp(PRINCIPAL, runtimeCom([{ texto }]).runtime)
    const res = await enviar(app, { text: 'resumo' })

    expect(res.statusCode).toBe(200)
    const bruto = JSON.parse(res.body) as { text?: unknown; messages?: unknown }
    expect(Array.isArray(bruto)).toBe(false)
    expect(bruto.messages).toBeUndefined()
    expect(agentReplySchema.parse(bruto).text).toBe(texto)

    const fonte = readFileSync(new URL('./agent.ts', import.meta.url), 'utf8')
    expect(fonte).not.toContain('formatarTextoWhatsApp')
    await app.close()
  })
})

describe('POST /agent/messages — proposta e aceite (US3 da spec 013)', () => {
  it('create_customer vira proposta com confirmationId e so grava no aceite', async () => {
    const { runtime, loja } = runtimeCom([
      { tool: 'create_customer', args: { name: 'João' } },
      { texto: 'Vou cadastrar o João. Posso?' },
      { tool: 'accept_proposal', args: {} },
      { texto: 'Pronto, João cadastrado.' },
    ])
    const app = buildApp(PRINCIPAL, runtime)

    const proposta = agentReplySchema.parse(
      JSON.parse((await enviar(app, { text: 'cadastra o João' })).body),
    )
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.confirmationId).toEqual(expect.any(String))
    expect(loja.gravacoes).toEqual([])

    const aceite = agentReplySchema.parse(JSON.parse((await enviar(app, { text: 'pode' })).body))
    expect(aceite).toEqual({ kind: 'answer', text: 'Pronto, João cadastrado.' })
    expect(loja.gravacoes.map((g) => g.acao)).toEqual(['registerCustomer'])
    await app.close()
  })

  it('create_sale vira proposta e resposta com ressalva nao grava', async () => {
    const { runtime, loja } = runtimeCom([
      {
        tool: 'create_sale',
        args: {
          customerId: 'Maria',
          items: [{ productId: 'café' }],
          payments: [{ method: 'pix' }],
        },
      },
      { texto: 'Vou registrar 1 café pra Maria no pix. Posso?' },
      { tool: 'accept_proposal', args: {} },
      { texto: 'Certo, qual a forma de pagamento então?' },
    ])
    const app = buildApp(PRINCIPAL, runtime)

    expect(
      JSON.parse((await enviar(app, { text: 'vende um café pra Maria no pix' })).body).kind,
    ).toBe('confirmation')
    const r = agentReplySchema.parse(
      JSON.parse((await enviar(app, { text: 'pode, mas no dinheiro' })).body),
    )
    expect(r.kind).toBe('answer')
    expect(loja.gravacoes).toEqual([])
    await app.close()
  })

  it('mutacoes NR-117 so gravam no aceite', async () => {
    const { runtime, loja } = runtimeCom([
      {
        tool: 'create_payable',
        args: {
          supplier: 'Imobiliária',
          description: 'Aluguel',
          amountCents: 180_000,
          dueDate: '2026-10-10',
        },
      },
      { texto: 'Vou lançar o aluguel de R$ 1.800,00 para 2026-10-10. Posso?' },
      { tool: 'cancel_proposal', args: {} },
      { texto: 'Tudo bem, não lancei.' },
    ])
    const app = buildApp(PRINCIPAL, runtime)
    expect(JSON.parse((await enviar(app, { text: 'lança o aluguel' })).body).kind).toBe(
      'confirmation',
    )
    expect(JSON.parse((await enviar(app, { text: 'deixa pra lá' })).body).kind).toBe('answer')
    expect(loja.gravacoes).toEqual([])
    await app.close()
  })
})

/*
 * Sem runtime a rota responde 503 com motivo: quem chama sabe que o
 * assistente esta desligado, e nao confunde com rota inexistente.
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
    const res = await enviar(app, { text: 'quanto vendi hoje?' })

    expect(res.statusCode).toBe(503)
    const corpo = JSON.parse(res.body) as { error: { code: string; message: string } }
    expect(corpo.error.code).toBe('UNAVAILABLE')
    expect(corpo.error.message).toMatch(/indisponivel/i)
    expect(corpo.error.message).toMatch(/harness/i)
    expect(corpo.error.message).toMatch(/fixture/i)
    await app.close()
  })

  it('propaga o motivo de harness off em prod (FR-001b)', async () => {
    const app = buildAppSemRuntime(
      'Harness do assistente desligado em producao (FR-001b). ' +
        'Defina AGENT_HARNESS=1 so para staging de engenharia.',
    )
    const res = await enviar(app, { text: 'quanto vendi hoje?' })

    expect(res.statusCode).toBe(503)
    const corpo = JSON.parse(res.body) as { error: { code: string; message: string } }
    expect(corpo.error.code).toBe('UNAVAILABLE')
    expect(corpo.error.message).toMatch(/FR-001b/)
    expect(corpo.error.message).toMatch(/AGENT_HARNESS=1/)
    await app.close()
  })
})
