import { describe, expect, it } from 'vitest'
import type { AgentUseCases } from './catalog.js'
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
}

describe('createAgentRuntime — US1', () => {
  it('injeta FakeLlm quando ninguem passa llm — modo local sem OpenAI', () => {
    const runtime = createAgentRuntime({ useCases })
    expect(runtime.llm).toBeInstanceOf(FakeLlm)
  })

  it('respeita o LlmPort injetado — caminho Mastra no mesmo runtime', () => {
    const llm: LlmPort = {
      decide: async () => ({ type: 'unknown' }),
    }
    const runtime = createAgentRuntime({ useCases, llm })
    expect(runtime.llm).toBe(llm)
    expect(runtime.llm).not.toBeInstanceOf(FakeLlm)
  })
})
