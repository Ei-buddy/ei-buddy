import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMastraLlm } from './mastra-llm.js'
import type { ToolDescriptor } from './types.js'

/**
 * O generate do Mastra pode disparar `execute` da tool. Quem chama `core` e
 * `processMessage`, depois da confirmacao. Estes mocks evitam OpenAI na CI
 * e deixam inspecionar o `execute` que o runtime registra.
 */
const mastra = vi.hoisted(() => {
  const tools: Array<{
    id: string
    execute: (input: unknown) => Promise<unknown>
  }> = []
  const state: { instructions: string | undefined } = { instructions: undefined }
  return {
    tools,
    state,
    createTool: vi.fn((opts: { id: string; execute: (input: unknown) => Promise<unknown> }) => {
      tools.push(opts)
      return opts
    }),
    Agent: class {
      constructor(opts: { instructions?: string }) {
        state.instructions = opts.instructions
      }
    },
  }
})

vi.mock('@mastra/core/tools', () => ({
  createTool: mastra.createTool,
}))

vi.mock('@mastra/core/agent', () => ({
  Agent: mastra.Agent,
}))

const ferramenta: ToolDescriptor = {
  id: 'list_sales',
  description: 'Consulta vendas.',
  inputSchema: z.object({ from: z.string(), to: z.string() }).strict(),
  mutatesValue: false,
}

describe('createMastraLlm — execute identidade (US1)', () => {
  const chaveAnterior = process.env.OPENAI_API_KEY

  afterEach(() => {
    mastra.tools.length = 0
    mastra.state.instructions = undefined
    mastra.createTool.mockClear()
    if (chaveAnterior === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = chaveAnterior
  })

  it('devolve os args validados e nao chama caso de uso', async () => {
    createMastraLlm({
      model: 'openai/gpt-4o-mini',
      apiKey: 'sk-nao-chamar',
      tools: [ferramenta],
    })

    expect(mastra.tools).toHaveLength(1)
    const args = { from: '2026-09-11', to: '2026-09-11' }
    const saida = await mastra.tools[0]!.execute(args)

    expect(saida).toBe(args)
  })

  it('instrui o modelo a preferir refuse_* para certificado, banco e nota avulsa — RF-149–151', () => {
    createMastraLlm({
      model: 'openai/gpt-4o-mini',
      apiKey: 'sk-nao-chamar',
      tools: [ferramenta],
    })

    const texto = mastra.state.instructions ?? ''
    expect(texto).toContain('refuse_certificate')
    expect(texto).toContain('refuse_banking')
    expect(texto).toContain('refuse_invoice_command')
    expect(texto).toMatch(/certificado|A1|emitente/)
    expect(texto).toMatch(/OFX|Open Finance|concili/)
    expect(texto).toMatch(/nota|NFC-e/)
    expect(texto).toMatch(/nao use create_sale/i)
  })
})
