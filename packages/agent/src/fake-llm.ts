import type { LlmDecision, LlmPort, ToolDescriptor } from './types.js'

function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * Duble de teste da porta LLM. Nao e modo de servidor.
 *
 * So devolve a decisao gravada com `script()`. Sem roteiro, a decisao e
 * `{ type: 'unknown' }`. `tools`, `today` e `history` nao escolhem tool.
 * A composicao da API nao monta esta classe para servir mensagem.
 */
export class FakeLlm implements LlmPort {
  private readonly roteiros = new Map<string, LlmDecision>()

  script(texto: string, decisao: LlmDecision): void {
    this.roteiros.set(normalizar(texto), decisao)
  }

  async decide(input: {
    readonly text: string
    readonly tools: readonly ToolDescriptor[]
    readonly today: string
    readonly history?: readonly { readonly role: string; readonly body: string }[]
  }): Promise<LlmDecision> {
    const roteiro = this.roteiros.get(normalizar(input.text))
    if (roteiro !== undefined) return roteiro
    return { type: 'unknown' }
  }
}
