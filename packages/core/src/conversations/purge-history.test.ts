import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '../context.js'
import type { ConversationPurgeRepository } from '../ports/conversations.js'
import {
  purgeConversationHistory,
  RETENCAO_MENSAGENS_MS,
  type PurgeConversationHistoryDeps,
} from './purge-history.js'

const AGORA = new Date('2026-09-17T18:00:00.000Z')
const EMPRESA = 'empresa-1'

function contexto(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: EMPRESA,
    userId: 'job',
    role: 'owner',
    channel: 'job',
    requestId: 'conversation-purge',
    now: AGORA,
    ...over,
  }
}

type Chamada = {
  readonly metodo: 'deleteMessagesOlderThan' | 'closeConversationsWithoutMessages'
  readonly companyId: string
  readonly now: Date
  readonly retentionMs?: number
}

function fakeRepo(inicial = { messages: 3, conversations: 1 }): {
  readonly conversations: ConversationPurgeRepository
  readonly chamadas: Chamada[]
} {
  const restante = { ...inicial }
  const chamadas: Chamada[] = []
  const conversations: ConversationPurgeRepository = {
    async deleteMessagesOlderThan(companyId, now, retentionMs) {
      chamadas.push({ metodo: 'deleteMessagesOlderThan', companyId, now, retentionMs })
      const n = restante.messages
      restante.messages = 0
      return n
    },
    async closeConversationsWithoutMessages(companyId, now) {
      chamadas.push({ metodo: 'closeConversationsWithoutMessages', companyId, now })
      const n = restante.conversations
      restante.conversations = 0
      return n
    },
  }
  return { conversations, chamadas }
}

describe('purgeConversationHistory — T033 (US5)', () => {
  it('apaga mensagens e fecha orfas com o relogio e a retencao injetados', async () => {
    const fake = fakeRepo()
    const deps: PurgeConversationHistoryDeps = { conversations: fake.conversations }

    const r = await purgeConversationHistory(deps, contexto())

    expect(r).toEqual({ messagesDeleted: 3, conversationsClosed: 1 })
    expect(fake.chamadas.map((c) => c.metodo)).toEqual([
      'deleteMessagesOlderThan',
      'closeConversationsWithoutMessages',
    ])
    expect(fake.chamadas[0]?.companyId).toBe(EMPRESA)
    expect(fake.chamadas[0]?.now).toBe(AGORA)
    expect(fake.chamadas[0]?.retentionMs).toBe(RETENCAO_MENSAGENS_MS)
    expect(fake.chamadas[0]?.retentionMs).toBe(30 * 24 * 60 * 60 * 1000)
    expect(fake.chamadas[1]?.companyId).toBe(EMPRESA)
    expect(fake.chamadas[1]?.now).toBe(AGORA)
  })

  it('segunda corrida no mesmo now devolve zeros (idempotente)', async () => {
    const fake = fakeRepo()
    const deps: PurgeConversationHistoryDeps = { conversations: fake.conversations }
    const ctx = contexto()

    const primeira = await purgeConversationHistory(deps, ctx)
    const segunda = await purgeConversationHistory(deps, ctx)

    expect(primeira).toEqual({ messagesDeleted: 3, conversationsClosed: 1 })
    expect(segunda).toEqual({ messagesDeleted: 0, conversationsClosed: 0 })
  })

  it('o contexto do job e channel job, nao o relogio do processo', async () => {
    const fake = fakeRepo({ messages: 0, conversations: 0 })
    const agoraInjetado = new Date('2020-01-01T00:00:00.000Z')

    await purgeConversationHistory(
      { conversations: fake.conversations },
      contexto({ now: agoraInjetado, channel: 'job' }),
    )

    expect(fake.chamadas[0]?.now.toISOString()).toBe('2020-01-01T00:00:00.000Z')
    expect(fake.chamadas[0]?.now).toBe(agoraInjetado)
  })
})
