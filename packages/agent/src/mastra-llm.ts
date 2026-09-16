import { createTool } from '@mastra/core/tools'
import { Agent } from '@mastra/core/agent'
import type { LlmDecision, LlmPort, ToolDescriptor } from './types.js'

const INSTRUCOES = `
Voce e o assistente de um ERP para lojistas, em portugues do Brasil.

Regras:
- Nunca calcule dinheiro, imposto, tarifa, parcela ou margem. Isso o sistema calcula.
- Para saber um numero, chame uma ferramenta. Sem ferramenta, diga que nao sabe.
- Se a pergunta nao casar com nenhuma ferramenta, nao invente resposta.
- Nao peca confirmacao: o sistema pede depois, quando a acao grava valor.
- Responda curto. Nao explique a ferramenta.
- Certificado A1, senha de certificado, arquivo PFX ou cadastro de emitente: chame refuse_certificate. Nao peca arquivo nem senha.
- Importar OFX/CSV, Open Finance ou conciliar banco: chame refuse_banking. Nao peca o extrato.
- Emitir ou cancelar nota/NFC-e sem registrar ou cancelar a venda: chame refuse_invoice_command. Nao use create_sale so para emitir nota; a nota e efeito da venda.
`.trim()

export type MastraLlmOptions = {
  readonly model: string
  readonly apiKey: string
  readonly tools: readonly ToolDescriptor[]
}

/**
 * LLM real — Mastra + OpenAI. As tools aqui so devolvem os argumentos
 * validados: quem executa o caso de uso e `processMessage`, depois da
 * confirmacao quando a acao mexe em valor. O modelo nao grava nada.
 */
export function createMastraLlm(opcoes: MastraLlmOptions): LlmPort {
  process.env.OPENAI_API_KEY = opcoes.apiKey

  const tools = Object.fromEntries(
    opcoes.tools.map((t) => [
      t.id,
      createTool({
        id: t.id,
        description: t.description,
        inputSchema: t.inputSchema,
        /* Identidade: o Mastra pode disparar a tool no generate; quem grava
           e `processMessage`, depois da confirmacao. Devolver os args nao
           chama `core`. */
        execute: async (input) => input,
      }),
    ]),
  )

  const agent = new Agent({
    id: 'erp-agent',
    name: 'Assistente',
    instructions: INSTRUCOES,
    model: opcoes.model,
    tools,
  })

  return {
    async decide({ text }): Promise<LlmDecision> {
      const result = await agent.generate(text, { maxSteps: 1 })
      const chamada = primeiraFerramenta(result)
      if (chamada !== undefined) {
        return { type: 'tool', name: chamada.name, args: chamada.args }
      }
      const texto = textoDaResposta(result)
      if (texto !== undefined && texto.trim() !== '') {
        return { type: 'text', text: texto.trim() }
      }
      return { type: 'unknown' }
    },
  }
}

function primeiraFerramenta(result: unknown): { name: string; args: unknown } | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const r = result as Record<string, unknown>
  const calls = r.toolCalls
  if (!Array.isArray(calls) || calls.length === 0) return undefined
  const c = calls[0]
  if (typeof c !== 'object' || c === null) return undefined
  const row = c as Record<string, unknown>
  const payload =
    typeof row.payload === 'object' && row.payload !== null
      ? (row.payload as Record<string, unknown>)
      : row
  const name = String(payload.toolName ?? payload.name ?? row.toolName ?? '')
  if (name === '') return undefined
  return { name, args: payload.args ?? payload.input ?? row.args ?? {} }
}

function textoDaResposta(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const texto = (result as Record<string, unknown>).text
  return typeof texto === 'string' ? texto : undefined
}
