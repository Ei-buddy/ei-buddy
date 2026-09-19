import { describe, expect, it } from 'vitest'
import type { AgentUseCases } from './catalog.js'
import { InMemoryConfirmations } from './confirmations.js'
import { InMemoryConversationStore } from './conversations.js'
import { createAgentRuntime } from './create-runtime.js'
import { FakeLlm } from './fake-llm.js'
import type { LlmPort } from './types.js'

const useCases: AgentUseCases = {
  listSales: async () => {
    throw new Error('nao executa neste teste')
  },
  listReceivables: async () => {
    throw new Error('nao executa neste teste')
  },
  checkStock: async () => {
    throw new Error('nao executa neste teste')
  },
  checkStockByQuery: async () => {
    throw new Error('nao executa neste teste')
  },
  checkCustomerWalletByQuery: async () => {
    throw new Error('nao executa neste teste')
  },
  listPayables: async () => {
    throw new Error('nao executa neste teste')
  },
  registerCustomer: async () => {
    throw new Error('nao executa neste teste')
  },
  registerSale: async () => {
    throw new Error('nao executa neste teste')
  },
  searchProducts: async () => [],
  revenueByMonth: async () => ({
    from: '2026-09-01',
    to: '2026-09-30',
    months: [],
    totalNetCents: 0,
  }),
  buildDre: async () => {
    throw new Error('nao executa neste teste')
  },
  sendCustomerCharge: async () => {
    throw new Error('nao executa neste teste')
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
}

describe('createAgentRuntime — US1', () => {
  it('injeta FakeLlm quando ninguem passa llm — modo local sem OpenAI', () => {
    const runtime = createAgentRuntime({ useCases })
    expect(runtime.llm).toBeInstanceOf(FakeLlm)
    expect(runtime.conversations).toBeInstanceOf(InMemoryConversationStore)
  })

  it('respeita o LlmPort injetado — caminho Mastra no mesmo runtime', () => {
    const llm: LlmPort = {
      decide: async () => ({ type: 'unknown' }),
    }
    const runtime = createAgentRuntime({ useCases, llm })
    expect(runtime.llm).toBe(llm)
    expect(runtime.llm).not.toBeInstanceOf(FakeLlm)
  })

  it('injeta InMemoryConfirmations quando ninguem passa confirmations', () => {
    const runtime = createAgentRuntime({ useCases })
    expect(runtime.confirmations).toBeInstanceOf(InMemoryConfirmations)
  })

  it('respeita o ConfirmationStore injetado', () => {
    const confirmations = new InMemoryConfirmations()
    const runtime = createAgentRuntime({ useCases, confirmations })
    expect(runtime.confirmations).toBe(confirmations)
  })

  it('LlmPort.decide aceita history opcional sem mudar o laco', async () => {
    const llm: LlmPort = {
      decide: async ({ history }) => {
        expect(history === undefined || history.length <= 12).toBe(true)
        return { type: 'unknown' }
      },
    }
    await llm.decide({
      text: 'oi',
      tools: [],
      today: '2026-09-11',
      history: [{ role: 'user', body: 'oi' }],
    })
  })
})
