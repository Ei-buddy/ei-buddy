import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  const generate = vi.fn(async () => ({ text: '' }))
  return {
    tools,
    state,
    generate,
    createTool: vi.fn((opts: { id: string; execute: (input: unknown) => Promise<unknown> }) => {
      tools.push(opts)
      return opts
    }),
    Agent: class {
      generate = generate
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
    mastra.generate.mockClear()
    mastra.generate.mockResolvedValue({ text: '' })
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

  it('inclui history no generate, com maxSteps 1 — T017', async () => {
    mastra.generate.mockResolvedValue({ text: 'Qual cliente?' })
    const llm = createMastraLlm({
      model: 'openai/gpt-4o-mini',
      apiKey: 'sk-nao-chamar',
      tools: [ferramenta],
    })

    const r = await llm.decide({
      text: 'manda a cobranca pra ele',
      tools: [ferramenta],
      today: '2026-09-11',
      history: [
        { role: 'user', body: 'cobra o joao' },
        { role: 'assistant', body: 'Enviar cobranca para cliente cli-1. Confirma?' },
      ],
    })

    expect(r).toEqual({ type: 'text', text: 'Qual cliente?' })
    expect(mastra.generate).toHaveBeenCalledOnce()
    const chamada = mastra.generate.mock.calls[0]
    expect(chamada).toBeDefined()
    if (chamada === undefined) return
    const [entrada, opcoes] = chamada
    expect(opcoes).toEqual({ maxSteps: 1 })
    const blob = typeof entrada === 'string' ? entrada : JSON.stringify(entrada)
    expect(blob).toContain('cobra o joao')
    expect(blob).toContain('cli-1')
    expect(blob).toContain('manda a cobranca pra ele')
  })

  it('sem history o generate recebe so o texto atual — T017', async () => {
    const llm = createMastraLlm({
      model: 'openai/gpt-4o-mini',
      apiKey: 'sk-nao-chamar',
      tools: [ferramenta],
    })
    await llm.decide({
      text: 'quanto vendi hoje?',
      tools: [ferramenta],
      today: '2026-09-11',
    })
    expect(mastra.generate).toHaveBeenCalledWith('quanto vendi hoje?', { maxSteps: 1 })
  })

  it('nao importa @mastra/memory — T017', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'mastra-llm.ts'), 'utf8')
    expect(src).not.toMatch(/@mastra\/memory/)
  })

  it('nao concatena alem do array recebido — T032', async () => {
    const llm = createMastraLlm({
      model: 'openai/gpt-4o-mini',
      apiKey: 'sk-nao-chamar',
      tools: [ferramenta],
    })
    const history = Array.from({ length: 13 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      body: `h-${i + 1}`,
    }))
    await llm.decide({
      text: 'agora',
      tools: [ferramenta],
      today: '2026-09-11',
      history,
    })

    expect(mastra.generate).toHaveBeenCalledOnce()
    const chamada = mastra.generate.mock.calls[0]
    expect(chamada).toBeDefined()
    if (chamada === undefined) return
    const [entrada] = chamada
    expect(Array.isArray(entrada)).toBe(true)
    if (!Array.isArray(entrada)) return
    expect(entrada.length).toBeLessThanOrEqual(13)
    expect(entrada[entrada.length - 1]).toEqual({ role: 'user', content: 'agora' })
    const corpos = entrada.slice(0, -1).map((m: { content: string }) => m.content)
    expect(corpos).not.toContain('h-1')
    expect(corpos.length).toBe(12)
    expect(corpos).toEqual([
      'h-2',
      'h-3',
      'h-4',
      'h-5',
      'h-6',
      'h-7',
      'h-8',
      'h-9',
      'h-10',
      'h-11',
      'h-12',
      'h-13',
    ])
  })
})
