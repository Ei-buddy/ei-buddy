import { RequestContext } from '@mastra/core/request-context'
import type { ExecutionContext } from '@na-regua/core'
import { describe, expect, it, vi } from 'vitest'
import type { AgentUseCases } from '../catalog.js'
import { createAgentRuntime } from '../create-runtime.js'
import { processMessage } from '../process-message.js'
import { criarLojaDeTeste } from '../test-support/loja-de-teste.js'
import { roteiroDoModelo, type EtapaRoteirizada } from '../test-support/mock-model.js'
import { FixturePeerDirectory } from './fixture-peer-directory.js'
import type { StudioPreset } from './presets.js'
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

const VENDAS_HOJE: readonly EtapaRoteirizada[] = [
  { tool: 'list_sales', args: { from: '2026-09-11', to: '2026-09-11' } },
  { texto: 'Hoje foram 3 vendas.' },
]

function vendasPorEmpresa(visto: string[] = []): AgentUseCases {
  const base = criarLojaDeTeste().useCases
  return {
    ...base,
    listSales: async (c) => {
      visto.push(c.companyId)
      const daA = c.companyId === UUID_A
      return {
        sales: [],
        total: 0,
        page: 1,
        pageSize: 20,
        summary: {
          salesCount: daA ? 3 : 1,
          grossCents: daA ? 15_000 : 99_000,
          netCents: daA ? 14_000 : 99_000,
          cardFeeCents: 0,
          netAfterFeesCents: daA ? 14_000 : 99_000,
          averageTicketCents: daA ? 5_000 : 99_000,
        },
      }
    },
  }
}

function envelopeDoGenerate(out: { text: string; toolResults?: unknown }) {
  const results = out.toolResults
  if (Array.isArray(results)) {
    for (const item of results) {
      const found = extrairEnvelope(item)
      if (found !== undefined) return found
    }
  }
  return { kind: 'answer', text: out.text } as {
    kind: string
    text: string
    confirmationId?: string
    durationMs?: number
  }
}

function extrairEnvelope(
  valor: unknown,
): { kind: string; text: string; confirmationId?: string; durationMs?: number } | undefined {
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

async function generateNoRele(
  text: string,
  over: {
    readonly useCases?: AgentUseCases
    readonly etapas?: readonly EtapaRoteirizada[]
    readonly requestContext?: Record<string, unknown>
    readonly directory?: FixturePeerDirectory
    readonly now?: () => Date
    readonly onTurn?: (turno: StudioTurnLog) => void
  } = {},
) {
  const dir = over.directory ?? directory
  const { modelo, chamadas } = roteiroDoModelo(over.etapas ?? VENDAS_HOJE)
  const runtime = createAgentRuntime({
    model: modelo,
    useCases: over.useCases ?? vendasPorEmpresa(),
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
  for (const [chave, valor] of Object.entries(over.requestContext ?? { preset: PRESET.id })) {
    requestContext.set(chave, valor)
  }
  const out = await agent.generate(text, { requestContext })
  return { runtime, chamadas, out, envelope: envelopeDoGenerate(out) }
}

describe('studio-harness — US1 conversar no harness', () => {
  it('mesma frase no rele (whatsapp) e em processMessage (app) tem o mesmo comportamento', async () => {
    const visto: string[] = []
    const useCases = vendasPorEmpresa(visto)
    const { modelo } = roteiroDoModelo(VENDAS_HOJE)
    const runtimeHttp = createAgentRuntime({ model: modelo, useCases, peers: directory })
    const http = await processMessage(runtimeHttp, {
      text: 'quanto vendi hoje?',
      requestId: 'req-app',
      now: agora,
      channel: 'app',
      ctx: ctxApp,
    })

    const { envelope } = await generateNoRele('quanto vendi hoje?', {
      useCases,
      requestContext: { preset: PRESET.id, companyId: UUID_B },
    })

    expect(http.kind).toBe('answer')
    expect(envelope.kind).toBe(http.kind)
    expect(envelope.text).toBe(http.text)
    expect(visto).toEqual([UUID_A, UUID_A])
  })
})

describe('paridade de canais — WhatsApp, app e Studio (US7)', () => {
  it('a mesma conversa produz a mesma sequencia de tools e o mesmo kind nos tres canais', async () => {
    const etapas: readonly EtapaRoteirizada[] = [
      {
        tool: 'create_sale',
        args: { items: [{ productId: 'café' }], payments: [{ method: 'pix' }] },
      },
      { texto: 'Vou registrar 1 café no pix. Posso?' },
    ]
    const nomesDasTools = (chamadas: readonly { prompt: unknown }[]) =>
      JSON.stringify(chamadas.map((c) => JSON.stringify(c.prompt).match(/"toolName":"[a-z_]+"/g)))

    const loja = () => {
      const base = criarLojaDeTeste()
      return {
        ...base.useCases,
        resolveProductId: async () => 'p-cafe',
        checkStock: async () => ({
          productId: 'p-cafe',
          description: 'café em grãos',
          salePriceCents: 2_500,
          stockQuantity: 0,
          location: null,
          minStock: 0,
          belowMinimum: false,
        }),
      }
    }

    const wa = roteiroDoModelo(etapas)
    const rWa = await processMessage(
      createAgentRuntime({ model: wa.modelo, useCases: loja(), peers: directory }),
      {
        text: 'vende um café no pix',
        requestId: 'r1',
        now: agora,
        channel: 'whatsapp',
        peer: PRESET.peer,
      },
    )

    const app = roteiroDoModelo(etapas)
    const rApp = await processMessage(createAgentRuntime({ model: app.modelo, useCases: loja() }), {
      text: 'vende um café no pix',
      requestId: 'r2',
      now: agora,
      channel: 'app',
      ctx: ctxApp,
    })

    const studio = await generateNoRele('vende um café no pix', { useCases: loja(), etapas })

    expect(rWa.kind).toBe('confirmation')
    expect(rApp.kind).toBe(rWa.kind)
    expect(studio.envelope.kind).toBe(rWa.kind)
    expect(rApp.text).toBe(rWa.text)
    expect(studio.envelope.text).toBe(rWa.text)
    expect(nomesDasTools(app.chamadas)).toBe(nomesDasTools(wa.chamadas))
    expect(nomesDasTools(studio.chamadas)).toBe(nomesDasTools(wa.chamadas))
  })
})

describe('studio-harness — US2 identidade forjada', () => {
  it('dois presets isolam vendas e companyId do cliente nao troca a loja', async () => {
    const visto: string[] = []
    const useCases = vendasPorEmpresa(visto)

    const daA = await generateNoRele('quanto vendi hoje?', {
      useCases,
      directory: directoryDuas,
      requestContext: { preset: PRESET.id },
    })
    expect(JSON.stringify(daA.chamadas[1]?.prompt)).toContain('150,00')
    expect(JSON.stringify(daA.chamadas[1]?.prompt)).not.toContain('990,00')

    const daB = await generateNoRele('quanto vendi hoje?', {
      useCases,
      directory: directoryDuas,
      requestContext: { preset: PRESET_B.id },
    })
    expect(JSON.stringify(daB.chamadas[1]?.prompt)).toContain('990,00')

    await generateNoRele('quanto vendi hoje?', {
      useCases,
      directory: directoryDuas,
      requestContext: { preset: PRESET.id, companyId: UUID_B, userId: USER_B, role: 'owner' },
    })
    expect(visto).toEqual([UUID_A, UUID_B, UUID_A])
  })

  it('ignored vira recusa generica nao vazia, sem chamar o modelo nem vazar a outra empresa', async () => {
    const visto: string[] = []
    const { envelope, chamadas } = await generateNoRele('quanto vendi hoje?', {
      useCases: vendasPorEmpresa(visto),
      directory: directoryDuas,
      requestContext: { preset: 'nao-existe', companyId: UUID_B },
    })

    expect(envelope.kind).toBe('ignored')
    expect(envelope.text).toMatch(/nao vinculado/i)
    for (const segredo of [UUID_A, UUID_B, PRESET.peer, PRESET_B.peer, PRESET_B.id]) {
      expect(envelope.text).not.toContain(segredo)
    }
    expect(visto).toEqual([])
    expect(chamadas).toHaveLength(0)
  })
})

describe('studio-harness — montarIncomingMessageRelay', () => {
  it('converte dataBase64 em bytes; text vazio por padrao', () => {
    const dataBase64 = Buffer.from('7891234567895', 'utf-8').toString('base64')
    const entrada = montarIncomingMessageRelay(
      { image: { mimeType: 'image/jpeg', dataBase64 } },
      'req-img',
      agora,
      PRESET.peer,
    )
    expect(entrada.text).toBe('')
    expect(entrada.image?.mimeType).toBe('image/jpeg')
    expect(JSON.stringify(entrada)).not.toContain(dataBase64)
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

describe('studio-harness — US3 durationMs e log', () => {
  it('mascararPeerDoStudio esconde o numero e guarda 4 digitos', () => {
    expect(mascararPeerDoStudio('5511999000001')).toBe('****0001')
    expect(mascararPeerDoStudio('+55 11 99900-0001')).toBe('****0001')
    expect(mascararPeerDoStudio('12')).toBe('****')
  })

  it('relogio injetavel mede startedAt ate o retorno de processMessage', async () => {
    const t0 = new Date('2026-09-11T15:00:00.000Z')
    const t1 = new Date('2026-09-11T15:00:00.412Z')
    let chamadas = 0
    const now = () => {
      chamadas += 1
      return chamadas === 1 ? t0 : t1
    }
    const { envelope } = await generateNoRele('quanto vendi hoje?', { now })
    expect(envelope.durationMs).toBe(412)
  })

  it('log agent.studio.turn traz companyId, peer mascarado, durationMs, kind e requestId', async () => {
    const onTurn = vi.fn()
    const { envelope } = await generateNoRele('quanto vendi hoje?', { onTurn })

    expect(onTurn).toHaveBeenCalledWith({
      companyId: UUID_A,
      peer: mascararPeerDoStudio(PRESET.peer),
      durationMs: envelope.durationMs,
      kind: 'answer',
      requestId: 'req-studio',
    })
    const serializado = JSON.stringify(onTurn.mock.calls)
    expect(serializado).not.toContain(PRESET.peer)
    expect(serializado).not.toContain(USER_A)
  })

  it('log de recusa nao vaza peer desconhecido nem companyId', async () => {
    const onTurn = vi.fn()
    const estranho = '5511988887777'
    await generateNoRele('quanto vendi hoje?', {
      directory: directoryDuas,
      requestContext: { peer: estranho, companyId: UUID_B },
      onTurn,
    })
    const turno = onTurn.mock.calls[0]?.[0]
    expect(turno).toMatchObject({ kind: 'ignored', requestId: 'req-studio' })
    expect(turno?.peer).toBeUndefined()
    expect(turno?.companyId).toBeUndefined()
    expect(JSON.stringify(onTurn.mock.calls)).not.toContain(estranho)
  })
})
