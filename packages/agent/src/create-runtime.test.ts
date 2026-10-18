import { describe, expect, it } from 'vitest'
import { InMemoryConfirmations } from './confirmations.js'
import { createAgentRuntime } from './create-runtime.js'
import { CONFIRMATION_TTL_MS, processMessage } from './process-message.js'
import { AGORA, criarLojaDeTeste } from './test-support/loja-de-teste.js'
import { roteiroDoModelo } from './test-support/mock-model.js'

describe('createAgentRuntime', () => {
  it('com model + useCases monta o brain do Buddy e defaults', async () => {
    const { modelo } = roteiroDoModelo([{ texto: 'Oi! Em que posso ajudar?' }])
    const runtime = createAgentRuntime({
      model: modelo,
      useCases: criarLojaDeTeste().useCases,
      peers: {
        resolve: async () => ({ companyId: 'emp-A', userId: 'user-A', role: 'owner' }),
      },
    })

    expect(runtime.confirmationTtlMs).toBe(CONFIRMATION_TTL_MS)
    expect(runtime.timeZone).toBe('America/Sao_Paulo')
    expect(runtime.conversations).toBeDefined()

    const r = await processMessage(runtime, {
      text: 'oi',
      requestId: 'req-1',
      now: AGORA,
      channel: 'whatsapp',
      peer: '5511999990000',
    })
    expect(r).toEqual({ kind: 'answer', text: 'Oi! Em que posso ajudar?' })
  })

  it('reaproveita as confirmations recebidas', () => {
    const confirmations = new InMemoryConfirmations()
    const runtime = createAgentRuntime({
      brain: {
        conversar: async () => ({ texto: '', etapas: 0, snapshot: { v: 2, entidades: [] } }),
      },
      confirmations,
    })
    expect(runtime.confirmations).toBe(confirmations)
  })
})
