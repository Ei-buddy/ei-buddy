import type { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'

/** O tipo de modelo que o `Agent` aceita — o dublê entra por aqui. */
export type ModeloDoAgente = ConstructorParameters<typeof Agent>[0]['model']

/** Uma resposta do modelo dublê: chamar uma tool ou escrever texto. */
export type EtapaRoteirizada =
  { readonly tool: string; readonly args?: unknown } | { readonly texto: string }

export type ChamadaRecebida = {
  readonly prompt: unknown
  readonly toolChoice: unknown
  readonly tools: readonly { readonly name: string }[]
}

export type ModeloRoteirizado = {
  readonly modelo: ModeloDoAgente
  /** O que o Agent mandou ao modelo em cada etapa, na ordem. */
  readonly chamadas: readonly ChamadaRecebida[]
}

/**
 * Modelo dublê para o `Agent` real do Mastra: uma resposta por etapa, na
 * ordem. Etapas além do roteiro respondem texto vazio, para o teste falhar
 * pela asserção e não por estouro.
 */
export function roteiroDoModelo(etapas: readonly EtapaRoteirizada[]): ModeloRoteirizado {
  const chamadas: ChamadaRecebida[] = []
  let indice = 0

  const modelo = new MastraLanguageModelV2Mock({
    doGenerate: async (opcoes) => {
      chamadas.push({
        prompt: opcoes.prompt,
        toolChoice: opcoes.toolChoice,
        tools: (opcoes.tools ?? []).map((t) => ({ name: t.name })),
      })
      const etapa = etapas[indice] ?? { texto: '' }
      const id = `etapa-${indice}`
      indice += 1
      const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }

      if ('tool' in etapa) {
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: `${id}-call`,
              toolName: etapa.tool,
              input: JSON.stringify(etapa.args ?? {}),
            },
          ],
          finishReason: 'tool-calls',
          usage,
          warnings: [],
        }
      }

      return {
        content: [{ type: 'text', text: etapa.texto }],
        finishReason: 'stop',
        usage,
        warnings: [],
      }
    },
  })

  /* O mock tipa `response` como opcional-indefinido, o que `exactOptionalPropertyTypes`
     recusa; em execução é o mesmo contrato que o Agent consome. */
  return { modelo: modelo as unknown as ModeloDoAgente, chamadas }
}
