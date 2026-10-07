import type { ExecutionContext } from '@na-regua/core'
import { describe, expect, it, vi } from 'vitest'
import type { ConversarInput, ConversarSaida } from './buddy-brain.js'
import { InMemoryConfirmations } from './confirmations.js'
import type { SnapshotDeTurno } from './conversation-context.js'
import { InMemoryConversationStore } from './conversations.js'
import { createAgentRuntime } from './create-runtime.js'
import { InMemoryAiUsageCounter, TEXTO_TETO_IA } from './ai-usage.js'
import { FRASE_PEDIDO_DE_TEXTO } from './catalog.js'
import { FRASE_DE_FALHA, processMessage } from './process-message.js'
import { AGORA, criarLojaDeTeste } from './test-support/loja-de-teste.js'
import { roteiroDoModelo } from './test-support/mock-model.js'
import type { AgentRuntime, BuddyBrain, IncomingMessage, PeerDirectory } from './types.js'

const PEER = '5511999990000'

const peers: PeerDirectory = {
  resolve: async (peer) =>
    peer === PEER ? { companyId: 'emp-A', userId: 'user-A', role: 'owner' } : null,
}

function msg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    text: 'tem café?',
    requestId: 'req-1',
    now: AGORA,
    channel: 'whatsapp',
    peer: PEER,
    ...over,
  }
}

const snapshotVazio: SnapshotDeTurno = { v: 2, entidades: [] }

function saida(over: Partial<ConversarSaida> = {}): ConversarSaida {
  return { texto: 'Tem café a R$ 25,00.', etapas: 2, snapshot: snapshotVazio, ...over }
}

type BrainFalso = BuddyBrain & { readonly entradas: ConversarInput[] }

function brainQueResponde(
  resposta: ConversarSaida | ((input: ConversarInput) => ConversarSaida | Promise<ConversarSaida>),
): BrainFalso {
  const entradas: ConversarInput[] = []
  return {
    entradas,
    conversar: async (input) => {
      entradas.push(input)
      return typeof resposta === 'function' ? resposta(input) : resposta
    },
  }
}

function runtimeCom(brain: BuddyBrain, over: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    ...createAgentRuntime({
      brain,
      peers,
      conversations: new InMemoryConversationStore(),
      confirmations: new InMemoryConfirmations(),
    }),
    ...over,
  }
}

describe('processMessage — histórico sem termo técnico (US1)', () => {
  it('o texto gravado no histórico é o limpo, nunca o original com UUID', async () => {
    const UUID = '78a3705e-de89-4b52-b5a2-276561075c13'
    const conversations = new InMemoryConversationStore()
    const { modelo } = roteiroDoModelo([
      { texto: `Tem café a R$ 25,00. Código ${UUID}.` },
      { texto: `Tem café a R$ 25,00. Código ${UUID}.` },
    ])
    const runtime = createAgentRuntime({
      model: modelo,
      useCases: criarLojaDeTeste().useCases,
      peers,
      conversations,
    })

    const r = await processMessage(runtime, msg())
    expect(r.text).toBe('Tem café a R$ 25,00.')

    const ativo = await conversations.loadActive('emp-A', `wa:emp-A:${PEER}`, AGORA)
    const corpos = ativo?.messages.map((m) => m.body) ?? []
    expect(corpos).toEqual(['tem café?', 'Tem café a R$ 25,00.'])
    expect(JSON.stringify(ativo?.messages)).not.toContain(UUID)
  })
})

describe('processMessage — pendente vencida e mudança de assunto (US3)', () => {
  function pendenteEm(confirmations: InMemoryConfirmations, expiraEm: Date) {
    return confirmations.put({
      id: 'conf-1',
      companyId: 'emp-A',
      conversationKey: `wa:emp-A:${PEER}`,
      toolId: 'create_sale',
      args: { entrada: {}, rotulos: {} },
      summary: '1x café em grãos a R$ 25,00; pagamento: pix R$ 25,00',
      expiresAt: expiraEm,
    })
  }

  it('pendente vencida e resolvida como expired e o fato vai ao brain', async () => {
    const confirmations = new InMemoryConfirmations()
    await pendenteEm(confirmations, new Date(AGORA.getTime() - 1_000))
    const resolve = vi.spyOn(confirmations, 'resolve')
    const brain = brainQueResponde(saida({ texto: 'Essa proposta venceu. Quer que eu refaça?' }))

    await processMessage(runtimeCom(brain, { confirmations }), msg({ text: 'sim' }))

    expect(resolve).toHaveBeenCalledWith('emp-A', 'conf-1', 'expired')
    const entrada = brain.entradas[0]!
    expect(entrada.pendente).toBeUndefined()
    expect(entrada.avisos?.join(' ')).toMatch(/venceu/)
  })

  it('pendente aberta vai ao brain', async () => {
    const confirmations = new InMemoryConfirmations()
    await pendenteEm(confirmations, new Date(AGORA.getTime() + 60_000))
    const brain = brainQueResponde(saida({ decidiuPendente: true }))
    await processMessage(runtimeCom(brain, { confirmations }), msg({ text: 'fechou' }))
    expect(brain.entradas[0]!.pendente?.id).toBe('conf-1')
  })

  it('brain termina sem decidir a pendente e sem nova proposta: rejected (mudança de assunto)', async () => {
    const confirmations = new InMemoryConfirmations()
    await pendenteEm(confirmations, new Date(AGORA.getTime() + 60_000))
    const resolve = vi.spyOn(confirmations, 'resolve')
    const brain = brainQueResponde(saida({ texto: 'Hoje foram 3 vendas.' }))

    await processMessage(runtimeCom(brain, { confirmations }), msg({ text: 'quanto vendi hoje?' }))

    expect(resolve).toHaveBeenCalledWith('emp-A', 'conf-1', 'rejected')
  })

  it('brain decidiu a pendente: nada a resolver na borda', async () => {
    const confirmations = new InMemoryConfirmations()
    await pendenteEm(confirmations, new Date(AGORA.getTime() + 60_000))
    const resolve = vi.spyOn(confirmations, 'resolve')
    const brain = brainQueResponde(saida({ decidiuPendente: true }))
    await processMessage(runtimeCom(brain, { confirmations }), msg({ text: 'fechou' }))
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('processMessage — contexto da conversa (US4)', () => {
  const joao = { tipo: 'cliente', ref: 'cli-1', rotulo: 'João' } as const

  it('a entidade do turno 1 chega no resumo do turno 2; depois de 2 h, nada chega', async () => {
    const conversations = new InMemoryConversationStore()
    let turno = 0
    const brain = brainQueResponde(() => {
      turno += 1
      return saida({ snapshot: turno === 1 ? { v: 2, entidades: [joao] } : snapshotVazio })
    })
    const runtime = runtimeCom(brain, { conversations })

    await processMessage(runtime, msg({ text: 'quanto o João deve?' }))
    await processMessage(
      runtime,
      msg({ text: 'ele quer comprar 2 cafés', now: new Date(AGORA.getTime() + 60_000) }),
    )
    expect(brain.entradas[1]!.resumo.entidades).toContainEqual(joao)

    const depois = new Date(AGORA.getTime() + 60_000 + 2 * 60 * 60_000 + 1_000)
    await processMessage(runtime, msg({ text: 'e ele?', now: depois }))
    expect(brain.entradas[2]!.resumo.entidades).toEqual([])
    expect(brain.entradas[2]!.janela).toEqual([])
  })

  it('a conversa de outra empresa nunca recebe a entidade da primeira', async () => {
    const conversations = new InMemoryConversationStore()
    const brain = brainQueResponde((input) =>
      saida({
        snapshot:
          input.execucao.companyId === 'emp-A' ? { v: 2, entidades: [joao] } : snapshotVazio,
      }),
    )
    const runtime = runtimeCom(brain, { conversations })
    const sessao = (companyId: string): ExecutionContext => ({
      companyId,
      userId: 'user-mesmo',
      role: 'owner',
      channel: 'app',
      requestId: 'req',
      now: AGORA,
    })
    const app = (companyId: string): IncomingMessage => ({
      text: 'oi',
      requestId: 'req',
      now: AGORA,
      channel: 'app',
      ctx: sessao(companyId),
    })

    await processMessage(runtime, app('emp-A'))
    await processMessage(runtime, app('emp-B'))
    await processMessage(runtime, app('emp-B'))
    expect(brain.entradas[2]!.execucao.companyId).toBe('emp-B')
    expect(brain.entradas[2]!.resumo.entidades).toEqual([])
  })
})

describe('processMessage — falha inesperada (US6)', () => {
  it('brain lança: frase fixa, nada pendente e o turno gravado com a frase', async () => {
    const conversations = new InMemoryConversationStore()
    const confirmations = new InMemoryConfirmations()
    const put = vi.spyOn(confirmations, 'put')
    const brain: BuddyBrain = {
      conversar: async () => {
        throw new Error('ECONNRESET api.openai.com')
      },
    }
    const r = await processMessage(runtimeCom(brain, { conversations, confirmations }), msg())

    expect(r).toEqual({ kind: 'answer', text: FRASE_DE_FALHA })
    expect(r.text).not.toMatch(/ECONNRESET|openai/i)
    expect(put).not.toHaveBeenCalled()
    const ativo = await conversations.loadActive('emp-A', `wa:emp-A:${PEER}`, AGORA)
    expect(ativo?.messages.at(-1)?.body).toBe(FRASE_DE_FALHA)
  })
})

describe('processMessage — foto e uso de IA (US7)', () => {
  it('foto recebe o pedido de texto sem chamar o brain', async () => {
    const brain = brainQueResponde(saida())
    const r = await processMessage(
      runtimeCom(brain),
      msg({ text: '', image: { mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) } }),
    )
    expect(r).toEqual({ kind: 'answer', text: FRASE_PEDIDO_DE_TEXTO })
    expect(brain.entradas).toHaveLength(0)
  })

  it('registra o uso por etapa e, sem teto, nunca bloqueia', async () => {
    const aiUsage = new InMemoryAiUsageCounter()
    const brain = brainQueResponde(saida({ etapas: 4 }))
    const runtime = runtimeCom(brain, { aiUsage })
    for (let i = 0; i < 3; i += 1) {
      const r = await processMessage(runtime, msg())
      expect(r.kind).toBe('answer')
      expect(r.text).not.toBe(TEXTO_TETO_IA)
    }
    expect(aiUsage.unitsOf('emp-A', AGORA)).toBe(12)
  })

  it('com teto configurado e estourado, avisa sem chamar o brain', async () => {
    const aiUsage = new InMemoryAiUsageCounter({ budgetCents: 4 })
    const brain = brainQueResponde(saida({ etapas: 4 }))
    const runtime = runtimeCom(brain, { aiUsage })
    await processMessage(runtime, msg())
    const r = await processMessage(runtime, msg())
    expect(r.text).toBe(TEXTO_TETO_IA)
    expect(brain.entradas).toHaveLength(1)
  })
})

describe('processMessage — borda do laço novo', () => {
  it('proposta nova vira confirmation com o id dela — US2', async () => {
    const brain = brainQueResponde(
      saida({ texto: 'Vou registrar 1 café no pix. Posso?', propostaNova: { id: 'conf-1' } }),
    )
    const r = await processMessage(runtimeCom(brain), msg())
    expect(r).toEqual({
      kind: 'confirmation',
      text: 'Vou registrar 1 café no pix. Posso?',
      confirmationId: 'conf-1',
    })
  })

  it('peer nao vinculado e ignorado sem chamar o brain', async () => {
    const brain = brainQueResponde(saida())
    const r = await processMessage(runtimeCom(brain), msg({ peer: '5500000000000' }))
    expect(r.kind).toBe('ignored')
    expect(brain.entradas).toHaveLength(0)
  })

  it('peer vinculado chama o brain com o contexto da empresa do peer', async () => {
    const brain = brainQueResponde(saida())
    const r = await processMessage(runtimeCom(brain), msg())
    expect(r).toEqual({ kind: 'answer', text: 'Tem café a R$ 25,00.' })
    const entrada = brain.entradas[0]!
    expect(entrada.execucao).toMatchObject<Partial<ExecutionContext>>({
      companyId: 'emp-A',
      userId: 'user-A',
      channel: 'whatsapp',
    })
    expect(entrada.texto).toBe('tem café?')
    expect(entrada.conversationKey).toBe(`wa:emp-A:${PEER}`)
    expect(entrada.hoje).toBe('2026-10-06')
  })

  it('grava o turno com o snapshot e manda a janela no turno seguinte', async () => {
    const conversations = new InMemoryConversationStore()
    const snapshot: SnapshotDeTurno = {
      v: 2,
      entidades: [{ tipo: 'produto', ref: 'p-cafe', rotulo: 'café em grãos' }],
    }
    const brain = brainQueResponde(saida({ snapshot }))
    const runtime = runtimeCom(brain, { conversations })

    await processMessage(runtime, msg())
    await processMessage(runtime, msg({ text: 'e o preço?' }))

    const segunda = brain.entradas[1]!
    expect(segunda.janela).toEqual([
      { role: 'user', body: 'tem café?' },
      { role: 'assistant', body: 'Tem café a R$ 25,00.' },
    ])
    expect(segunda.resumo.entidades).toContainEqual(snapshot.entidades[0])
  })

  it('a janela tem no maximo 12 mensagens', async () => {
    const brain = brainQueResponde(saida())
    const runtime = runtimeCom(brain)
    for (let i = 0; i < 8; i += 1) {
      await processMessage(runtime, msg({ text: `pergunta ${i}` }))
    }
    expect(brain.entradas[7]!.janela.length).toBeLessThanOrEqual(12)
  })

  it('canal app usa a sessao do contexto', async () => {
    const brain = brainQueResponde(saida())
    const append = vi.fn(async () => undefined)
    const runtime = runtimeCom(brain, {
      conversations: { loadActive: async () => undefined, append },
    })
    const ctx: ExecutionContext = {
      companyId: 'emp-A',
      userId: 'user-A',
      role: 'owner',
      channel: 'app',
      requestId: 'req-1',
      now: AGORA,
    }
    const r = await processMessage(runtime, {
      text: 'oi',
      requestId: 'req-2',
      now: AGORA,
      channel: 'app',
      ctx,
    })
    expect(r.kind).toBe('answer')
    expect(brain.entradas[0]!.conversationKey).toBe('app:emp-A:user-A')
    expect(append).toHaveBeenCalledWith(
      'emp-A',
      expect.objectContaining({ toolCalls: snapshotVazio }),
    )
  })
})
