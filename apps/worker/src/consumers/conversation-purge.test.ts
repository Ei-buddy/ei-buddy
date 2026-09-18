import { describe, expect, it } from 'vitest'
import { RETENCAO_MENSAGENS_MS, type ConversationPurgeRepository } from '@na-regua/core'
import { createFakeInvoiceIssuer } from '@na-regua/fiscal'
import { createFakeMessageSender } from '@na-regua/whatsapp'
import type { ConsumerDeps } from './types.js'
import { consumirExpurgo } from './conversation-purge.js'

const AGORA = new Date('2026-09-17T18:00:00.000Z')

type Chamada = {
  readonly metodo: 'deleteMessagesOlderThan' | 'closeConversationsWithoutMessages'
  readonly companyId: string
  readonly now: Date
  readonly retentionMs?: number
}

function fakePurge(porTenant: Record<string, { messages: number; conversations: number }>) {
  const restante = Object.fromEntries(Object.entries(porTenant).map(([id, n]) => [id, { ...n }]))
  const chamadas: Chamada[] = []
  const conversations: ConversationPurgeRepository = {
    async deleteMessagesOlderThan(companyId, now, retentionMs) {
      chamadas.push({ metodo: 'deleteMessagesOlderThan', companyId, now, retentionMs })
      const n = restante[companyId]?.messages ?? 0
      if (restante[companyId]) restante[companyId].messages = 0
      return n
    },
    async closeConversationsWithoutMessages(companyId, now) {
      chamadas.push({ metodo: 'closeConversationsWithoutMessages', companyId, now })
      const n = restante[companyId]?.conversations ?? 0
      if (restante[companyId]) restante[companyId].conversations = 0
      return n
    },
  }
  return { conversations, chamadas }
}

function deps(over: Partial<ConsumerDeps> = {}): ConsumerDeps {
  const purge = fakePurge({})
  return {
    invoices: createFakeInvoiceIssuer(),
    messages: createFakeMessageSender(),
    overdue: { listOverdue: async () => [] },
    enqueue: { add: async () => undefined },
    now: () => AGORA,
    conversations: purge.conversations,
    listTenantIds: async () => [],
    ...over,
  }
}

describe('expurgo de conversa — T039 (US5)', () => {
  it('chama o caso de uso por tenant, soma contagens e ignora o payload', async () => {
    const purge = fakePurge({
      'empresa-a': { messages: 2, conversations: 1 },
      'empresa-b': { messages: 3, conversations: 0 },
    })
    const d = deps({
      conversations: purge.conversations,
      listTenantIds: async () => ['empresa-a', 'empresa-b'],
    })

    const r = await consumirExpurgo(d)

    expect(r.outcome).toBe('purged')
    expect(r.detalhes).toEqual({ messagesDeleted: 5, conversationsClosed: 1 })
    expect(purge.chamadas.map((c) => c.metodo)).toEqual([
      'deleteMessagesOlderThan',
      'closeConversationsWithoutMessages',
      'deleteMessagesOlderThan',
      'closeConversationsWithoutMessages',
    ])
    expect(purge.chamadas[0]?.companyId).toBe('empresa-a')
    expect(purge.chamadas[0]?.now).toBe(AGORA)
    expect(purge.chamadas[0]?.retentionMs).toBe(RETENCAO_MENSAGENS_MS)
    expect(purge.chamadas[2]?.companyId).toBe('empresa-b')
  })

  it('lista vazia devolve purged com zeros, como a varredura sem vencidos', async () => {
    const r = await consumirExpurgo(deps())

    expect(r).toEqual({
      outcome: 'purged',
      detalhes: { messagesDeleted: 0, conversationsClosed: 0 },
    })
  })

  it('segunda corrida no mesmo now devolve zeros', async () => {
    const purge = fakePurge({ 'empresa-a': { messages: 4, conversations: 2 } })
    const d = deps({
      conversations: purge.conversations,
      listTenantIds: async () => ['empresa-a'],
    })

    const primeira = await consumirExpurgo(d)
    const segunda = await consumirExpurgo(d)

    expect(primeira.detalhes).toEqual({ messagesDeleted: 4, conversationsClosed: 2 })
    expect(segunda.detalhes).toEqual({ messagesDeleted: 0, conversationsClosed: 0 })
  })

  it('usa deps.now injetado, nao o relogio do processo', async () => {
    const agoraInjetado = new Date('2021-04-05T06:07:08.000Z')
    const purge = fakePurge({ 'empresa-a': { messages: 1, conversations: 0 } })
    const d = deps({
      conversations: purge.conversations,
      listTenantIds: async () => ['empresa-a'],
      now: () => agoraInjetado,
    })

    await consumirExpurgo(d)

    expect(purge.chamadas[0]?.now.toISOString()).toBe('2021-04-05T06:07:08.000Z')
  })
})
