import { RequestContext } from '@mastra/core/request-context'
import type { ExecutionContext } from '@na-regua/core'
import { describe, expect, it, vi } from 'vitest'
import { textoDasCapacidades, type AgentUseCases } from '../catalog.js'
import { createAgentRuntime } from '../create-runtime.js'
import { FakeLlm } from '../fake-llm.js'
import { chaveDaConversa, formatarCentavos } from '../format.js'
import { processMessage } from '../process-message.js'
import { FixturePeerDirectory } from './fixture-peer-directory.js'
import type { StudioPreset } from './presets.js'
import { bytesFromMarker } from '../barcode-decoder.js'
import {
  createStudioHarnessAgent,
  mascararPeerDoStudio,
  montarIncomingMessageRelay,
  type StudioTurnLog,
} from './relay-agent.js'

const agora = new Date('2026-09-11T15:00:00.000Z')
const UUID_A = '00000000-0000-4000-8000-000000000001'
const USER_A = '00000000-0000-4000-8000-000000000011'
const UUID_B = '00000000-0000-4000-8000-000000000002'
const USER_B = '00000000-0000-4000-8000-000000000012'

const PRESET: StudioPreset = {
  id: 'claudia-loja-1',
  peer: '5511999000001',
  companyId: UUID_A,
  userId: USER_A,
  role: 'owner',
}

const PRESET_B: StudioPreset = {
  id: 'claudia-loja-2',
  peer: '5511999000002',
  companyId: UUID_B,
  userId: USER_B,
  role: 'owner',
}

const directory = new FixturePeerDirectory([PRESET])
const directoryDuas = new FixturePeerDirectory([PRESET, PRESET_B])

const ctxApp: ExecutionContext = {
  companyId: UUID_A,
  userId: USER_A,
  role: 'owner',
  channel: 'app',
  requestId: 'req-app',
  now: agora,
}

function casos(over: Partial<AgentUseCases> = {}): AgentUseCases {
  return {
    listSales: async () => ({
      sales: [],
      total: 0,
      page: 1,
      pageSize: 20,
      summary: {
        salesCount: 3,
        grossCents: 15_000,
        netCents: 14_000,
        cardFeeCents: 500,
        netAfterFeesCents: 13_500,
        averageTicketCents: 5_000,
      },
    }),
    listReceivables: async () => ({ grupos: [], totalCents: 0, temVencidas: false }),
    checkStock: async () => {
      throw new Error('nao deveria consultar estoque neste teste')
    },
    checkStockByQuery: async () => {
      throw new Error('nao deveria consultar estoque neste teste')
    },
    checkCustomerWalletByQuery: async () => {
      throw new Error('nao deveria consultar fiado neste teste')
    },
    listPayables: async () => {
      throw new Error('nao deveria consultar contas a pagar neste teste')
    },
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
    findProductByBarcode: async () => undefined,
    registerProduct: async () => {
      throw new Error('nao executa neste teste')
    },
    createPayable: async () => {
      throw new Error('nao executa neste teste')
    },
    createReceivable: async () => {
      throw new Error('nao executa neste teste')
    },
    settlePayable: async () => {
      throw new Error('nao executa neste teste')
    },
    settleReceivable: async () => {
      throw new Error('nao executa neste teste')
    },
    adjustStock: async () => {
      throw new Error('nao executa neste teste')
    },
    cancelSale: async () => {
      throw new Error('nao executa neste teste')
    },
    createAppointment: async () => {
      throw new Error('nao executa neste teste')
    },
    listDayAppointments: async () => {
      throw new Error('nao executa neste teste')
    },
    ...over,
  }
}

function envelopeDoGenerate(out: { text: string; toolResults?: unknown }): {
  kind: string
  text: string
  confirmationId?: string
  durationMs?: number
} {
  const results = out.toolResults
  if (Array.isArray(results)) {
    for (const item of results) {
      const found = extrairEnvelope(item)
      if (found !== undefined) return found
    }
  }
  return { kind: 'answer', text: out.text }
}

function extrairEnvelope(valor: unknown):
  | {
      kind: string
      text: string
      confirmationId?: string
      durationMs?: number
    }
  | undefined {
  if (valor === null || typeof valor !== 'object') return undefined
  const row = valor as Record<string, unknown>
  if (typeof row.kind === 'string' && typeof row.text === 'string') {
    return {
      kind: row.kind,
      text: row.text,
      ...(typeof row.confirmationId === 'string' ? { confirmationId: row.confirmationId } : {}),
      ...(typeof row.durationMs === 'number' ? { durationMs: row.durationMs } : {}),
    }
  }
  for (const chave of ['result', 'output', 'payload', 'value'] as const) {
    const found = extrairEnvelope(row[chave])
    if (found !== undefined) return found
  }
  return undefined
}

function resumoVendas(companyId: string) {
  const daA = companyId === UUID_A
  return {
    sales: [],
    total: 0,
    page: 1,
    pageSize: 20,
    summary: {
      salesCount: daA ? 3 : 1,
      grossCents: daA ? 15_000 : 99_000,
      netCents: daA ? 14_000 : 99_000,
      cardFeeCents: daA ? 500 : 0,
      netAfterFeesCents: daA ? 13_500 : 99_000,
      averageTicketCents: daA ? 5_000 : 99_000,
    },
  }
}

async function generateNoRele(
  text: string,
  over: {
    readonly useCases?: AgentUseCases
    readonly requestContext?: Record<string, unknown>
    readonly directory?: FixturePeerDirectory
    readonly runtime?: ReturnType<typeof createAgentRuntime>
    readonly llm?: FakeLlm
    readonly now?: () => Date
    readonly onTurn?: (turno: StudioTurnLog) => void
  } = {},
) {
  const dir = over.directory ?? directory
  const llm = over.llm ?? new FakeLlm()
  const decide = vi.spyOn(llm, 'decide')
  const runtime =
    over.runtime ??
    createAgentRuntime({
      useCases: over.useCases ?? casos(),
      llm,
      peers: dir,
    })
  const agent = createStudioHarnessAgent({
    runtime,
    directory: dir,
    now: over.now ?? (() => agora),
    requestId: () => 'req-studio',
    ...(over.onTurn === undefined ? {} : { onTurn: over.onTurn }),
  })
  const requestContext = new RequestContext()
  const values = over.requestContext ?? { preset: PRESET.id }
  for (const [chave, valor] of Object.entries(values)) {
    requestContext.set(chave, valor)
  }
  const out = await agent.generate(text, { requestContext })
  return { runtime, llm, decide, out, envelope: envelopeDoGenerate(out) }
}

describe('studio-harness — US1 conversar no harness', () => {
  it('mesma frase no rele (whatsapp) e em processMessage (app) devolve os mesmos centavos/kind', async () => {
    const visto: string[] = []
    const useCases = casos({
      listSales: async (c) => {
        visto.push(c.companyId)
        return {
          sales: [],
          total: 0,
          page: 1,
          pageSize: 20,
          summary: {
            salesCount: 3,
            grossCents: 15_000,
            netCents: 14_000,
            cardFeeCents: 500,
            netAfterFeesCents: 13_500,
            averageTicketCents: 5_000,
          },
        }
      },
    })
    const runtimeHttp = createAgentRuntime({ useCases, peers: directory })
    const http = await processMessage(runtimeHttp, {
      text: 'quanto vendi hoje?',
      requestId: 'req-app',
      now: agora,
      channel: 'app',
      ctx: ctxApp,
    })

    const { decide, envelope } = await generateNoRele('quanto vendi hoje?', {
      useCases,
      requestContext: { preset: PRESET.id, companyId: UUID_B },
    })

    expect(http.kind).toBe('answer')
    expect(envelope.kind).toBe(http.kind)
    expect(envelope.text).toBe(http.text)
    expect(http.text).toContain('3 vendas')
    expect(http.text).toContain(formatarCentavos(15_000))
    expect(http.text).toContain(formatarCentavos(13_500))
    expect(http.text).toContain(formatarCentavos(5_000))
    expect(visto).toEqual([UUID_A, UUID_A])
    expect(decide).toHaveBeenCalledOnce()
  })

  it('frase fora do catalogo devolve unknown + textoDasCapacidades, sem inventar estoque', async () => {
    const { runtime, decide, envelope } = await generateNoRele('me conta uma piada', {
      requestContext: { preset: PRESET.id, companyId: UUID_B },
    })
    const esperado = textoDasCapacidades(runtime.tools)

    expect(envelope.kind).toBe('unknown')
    expect(envelope.text).toBe(esperado)
    expect(envelope.text).toContain('list_sales')
    expect(envelope.text).toContain('create_sale')
    expect(envelope.text).not.toMatch(/estoque|em breve|list_stock/i)
    expect(decide).toHaveBeenCalledOnce()
  })
})

describe('studio-harness — US2 identidade forjada', () => {
  it('dois presets isolam vendas: A nao ve B, e companyId do cliente nao troca a loja', async () => {
    const visto: string[] = []
    const useCases = casos({
      listSales: async (c) => {
        visto.push(c.companyId)
        return resumoVendas(c.companyId)
      },
    })

    const daA = await generateNoRele('quanto vendi hoje?', {
      useCases,
      directory: directoryDuas,
      requestContext: { preset: PRESET.id },
    })
    expect(daA.envelope.kind).toBe('answer')
    expect(daA.envelope.text).toContain('3 vendas')
    expect(daA.envelope.text).toContain(formatarCentavos(15_000))
    expect(daA.envelope.text).not.toContain(formatarCentavos(99_000))

    const daB = await generateNoRele('quanto vendi hoje?', {
      useCases,
      directory: directoryDuas,
      requestContext: { preset: PRESET_B.id },
    })
    expect(daB.envelope.kind).toBe('answer')
    expect(daB.envelope.text).toContain('1 venda')
    expect(daB.envelope.text).toContain(formatarCentavos(99_000))
    expect(daB.envelope.text).not.toContain(formatarCentavos(15_000))

    const forjado = await generateNoRele('quanto vendi hoje?', {
      useCases,
      directory: directoryDuas,
      requestContext: { preset: PRESET.id, companyId: UUID_B, userId: USER_B, role: 'owner' },
    })
    expect(forjado.envelope.text).toContain(formatarCentavos(15_000))
    expect(forjado.envelope.text).not.toContain(formatarCentavos(99_000))
    expect(visto).toEqual([UUID_A, UUID_B, UUID_A])
  })

  it('ignored com texto vazio vira recusa generica nao vazia, sem vazar a outra empresa', async () => {
    const listSales = vi.fn(async () => resumoVendas(UUID_A))
    const { envelope, decide } = await generateNoRele('quanto vendi hoje?', {
      useCases: casos({ listSales }),
      directory: directoryDuas,
      requestContext: { preset: 'nao-existe', companyId: UUID_B },
    })

    expect(envelope.kind).toBe('ignored')
    expect(envelope.text.trim().length).toBeGreaterThan(0)
    expect(envelope.text).toMatch(/nao vinculado/i)
    expect(envelope.text).not.toContain(UUID_A)
    expect(envelope.text).not.toContain(UUID_B)
    expect(envelope.text).not.toContain(PRESET.peer)
    expect(envelope.text).not.toContain(PRESET_B.peer)
    expect(envelope.text).not.toContain(PRESET_B.id)
    expect(listSales).not.toHaveBeenCalled()
    expect(decide).not.toHaveBeenCalled()
  })

  it('create_customer no whatsapp pede confirmacao wa:…; sim grava e talvez nao', async () => {
    const pedido = 'cadastra o Joao, 11 98888-7777'
    const args = { name: 'Joao', phone: '11 98888-7777' }

    let gravados = 0
    const useCases = casos({
      registerCustomer: async (c, input) => {
        gravados += 1
        expect(c.companyId).toBe(UUID_A)
        expect(c.channel).toBe('whatsapp')
        return {
          status: 'created' as const,
          customer: {
            id: 'cli-1',
            name: input.name,
            tradeName: input.tradeName ?? null,
            document: null,
            phone: input.phone ?? null,
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
            deletedAt: null,
          },
        }
      },
    })

    const llmSim = new FakeLlm()
    llmSim.script(pedido, { type: 'tool', name: 'create_customer', args })
    const runtimeSim = createAgentRuntime({ useCases, llm: llmSim, peers: directory })
    const put = vi.spyOn(runtimeSim.confirmations, 'put')

    const proposta = await generateNoRele(pedido, {
      directory,
      runtime: runtimeSim,
      llm: llmSim,
      requestContext: { preset: PRESET.id },
    })
    expect(proposta.envelope.kind).toBe('confirmation')
    expect(proposta.envelope.text).toMatch(/Confirma\?/)
    expect(proposta.envelope.confirmationId).toEqual(expect.any(String))
    expect(gravados).toBe(0)
    expect(put).toHaveBeenCalledOnce()
    expect(put.mock.calls[0]?.[0]?.conversationKey).toBe(
      chaveDaConversa({
        channel: 'whatsapp',
        companyId: UUID_A,
        userId: USER_A,
        peer: PRESET.peer,
      }),
    )
    expect(put.mock.calls[0]?.[0]?.conversationKey).toBe(`wa:${UUID_A}:${PRESET.peer}`)

    const sim = await generateNoRele('sim', {
      directory,
      runtime: runtimeSim,
      llm: llmSim,
      requestContext: { preset: PRESET.id },
    })
    expect(sim.envelope.kind).toBe('answer')
    expect(sim.envelope.text).toBe('Cliente Joao cadastrado.')
    expect(gravados).toBe(1)

    const llmTalvez = new FakeLlm()
    llmTalvez.script(pedido, { type: 'tool', name: 'create_customer', args })
    const runtimeTalvez = createAgentRuntime({ useCases, llm: llmTalvez, peers: directory })
    gravados = 0
    await generateNoRele(pedido, {
      directory,
      runtime: runtimeTalvez,
      llm: llmTalvez,
      requestContext: { preset: PRESET.id },
    })
    const talvez = await generateNoRele('talvez', {
      directory,
      runtime: runtimeTalvez,
      llm: llmTalvez,
      requestContext: { preset: PRESET.id },
    })
    expect(talvez.envelope.kind).toBe('answer')
    expect(talvez.envelope.text).toMatch(/cancelei/i)
    expect(talvez.envelope.text).toMatch(/Nada foi registrado/)
    expect(gravados).toBe(0)
  })
})

describe('studio-harness — NR-116 foto', () => {
  it('montarIncomingMessageRelay converte dataBase64 em bytes; text vazio por padrao', () => {
    const marker = '7891234567895'
    const dataBase64 = Buffer.from(marker, 'utf-8').toString('base64')
    const entrada = montarIncomingMessageRelay(
      { image: { mimeType: 'image/jpeg', dataBase64 } },
      'req-img',
      agora,
      PRESET.peer,
    )

    expect(entrada.text).toBe('')
    expect(entrada.image?.mimeType).toBe('image/jpeg')
    expect(entrada.image?.bytes).toEqual(bytesFromMarker(marker))
    expect(JSON.stringify(entrada)).not.toContain(dataBase64)
    expect(JSON.stringify(entrada)).not.toMatch(/data:image\//)
  })

  it('texto so no relay permanece igual ao HTTP', () => {
    const entrada = montarIncomingMessageRelay(
      { text: 'quanto vendi hoje?' },
      'req-txt',
      agora,
      PRESET.peer,
    )
    expect(entrada.text).toBe('quanto vendi hoje?')
    expect(entrada.image).toBeUndefined()
  })
})

describe('studio-harness — US3 durationMs', () => {
  it('mascararPeerDoStudio esconde o numero e guarda 4 digitos', () => {
    expect(mascararPeerDoStudio('5511999000001')).toBe('****0001')
    expect(mascararPeerDoStudio('+55 11 99900-0001')).toBe('****0001')
    expect(mascararPeerDoStudio('12')).toBe('****')
  })
  it('apos consulta o envelope tem durationMs number >= 0', async () => {
    const { envelope } = await generateNoRele('quanto vendi hoje?', {
      requestContext: { preset: PRESET.id },
    })

    expect(envelope.kind).toBe('answer')
    expect(typeof envelope.durationMs).toBe('number')
    expect(envelope.durationMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(envelope.durationMs)).toBe(true)
  })

  it('apos sim o envelope tem durationMs number >= 0', async () => {
    const pedido = 'cadastra o Joao, 11 98888-7777'
    const args = { name: 'Joao', phone: '11 98888-7777' }
    const useCases = casos({
      registerCustomer: async (_c, input) => ({
        status: 'created' as const,
        customer: {
          id: 'cli-1',
          name: input.name,
          tradeName: input.tradeName ?? null,
          document: null,
          phone: input.phone ?? null,
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
          deletedAt: null,
        },
      }),
    })
    const llm = new FakeLlm()
    llm.script(pedido, { type: 'tool', name: 'create_customer', args })
    const runtime = createAgentRuntime({ useCases, llm, peers: directory })

    await generateNoRele(pedido, {
      directory,
      runtime,
      llm,
      requestContext: { preset: PRESET.id },
    })
    const sim = await generateNoRele('sim', {
      directory,
      runtime,
      llm,
      requestContext: { preset: PRESET.id },
    })

    expect(sim.envelope.kind).toBe('answer')
    expect(sim.envelope.text).toBe('Cliente Joao cadastrado.')
    expect(typeof sim.envelope.durationMs).toBe('number')
    expect(sim.envelope.durationMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(sim.envelope.durationMs)).toBe(true)
  })

  it('relogio injetavel mede startedAt ate o retorno de processMessage', async () => {
    const t0 = new Date('2026-09-11T15:00:00.000Z')
    const t1 = new Date('2026-09-11T15:00:00.412Z')
    let chamadas = 0
    const now = () => {
      chamadas += 1
      return chamadas === 1 ? t0 : t1
    }

    const { envelope } = await generateNoRele('quanto vendi hoje?', {
      requestContext: { preset: PRESET.id },
      now,
    })

    expect(envelope.durationMs).toBe(412)
    expect(chamadas).toBeGreaterThanOrEqual(2)
  })

  it('log agent.studio.turn traz companyId, peer mascarado, durationMs, kind e requestId', async () => {
    const onTurn = vi.fn()
    const { envelope } = await generateNoRele('quanto vendi hoje?', {
      requestContext: { preset: PRESET.id },
      onTurn,
    })

    expect(onTurn).toHaveBeenCalledOnce()
    expect(onTurn).toHaveBeenCalledWith({
      companyId: UUID_A,
      peer: mascararPeerDoStudio(PRESET.peer),
      durationMs: envelope.durationMs,
      kind: 'answer',
      requestId: 'req-studio',
    })
    expect(onTurn.mock.calls[0]?.[0]?.peer).toBe('****0001')
    const serializado = JSON.stringify(onTurn.mock.calls)
    expect(serializado).not.toContain(PRESET.peer)
    expect(serializado).not.toContain(USER_A)
    expect(serializado).not.toMatch(/Joao|98888/)
  })

  it('log de recusa nao vaza peer desconhecido nem companyId', async () => {
    const onTurn = vi.fn()
    const estranho = '5511988887777'
    await generateNoRele('quanto vendi hoje?', {
      directory: directoryDuas,
      requestContext: { peer: estranho, companyId: UUID_B },
      onTurn,
    })

    expect(onTurn).toHaveBeenCalledOnce()
    const turno = onTurn.mock.calls[0]?.[0]
    expect(turno).toMatchObject({
      durationMs: expect.any(Number),
      kind: 'ignored',
      requestId: 'req-studio',
    })
    expect(turno?.peer).toBeUndefined()
    expect(turno?.companyId).toBeUndefined()
    const serializado = JSON.stringify(onTurn.mock.calls)
    expect(serializado).not.toContain(estranho)
    expect(serializado).not.toContain(UUID_A)
    expect(serializado).not.toContain(UUID_B)
    expect(serializado).not.toContain(PRESET.peer)
    expect(serializado).not.toContain(PRESET_B.peer)
  })
})
