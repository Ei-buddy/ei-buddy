import type { MastraModelConfig } from '@mastra/core/llm'

const TOOL = 'process_message'
const VAZIO: { inputTokens: number; outputTokens: number; totalTokens: number } = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

type PromptPart = {
  readonly type?: string
  readonly text?: string
  readonly toolName?: string
  readonly output?: { readonly type?: string; readonly value?: unknown }
  readonly result?: unknown
}

type PromptMsg = {
  readonly role?: string
  readonly content?: string | readonly PromptPart[]
}

/**
 * Model do relé: sempre emite `process_message` com o texto do usuario.
 * Depois do resultado da tool, devolve o texto e para. Zero OpenAI.
 */
export class StudioRelayModel {
  readonly specificationVersion = 'v2' as const
  readonly provider = 'na-regua'
  readonly modelId = 'studio-relay'
  readonly supportedUrls: Record<string, RegExp[]> = {}

  async doGenerate(options: { prompt: readonly PromptMsg[] }): Promise<{
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
    >
    finishReason: 'stop' | 'tool-calls'
    usage: typeof VAZIO
    warnings: []
  }> {
    const resultado = textoDoToolResult(options.prompt)
    if (resultado !== undefined) {
      return {
        content: [{ type: 'text', text: resultado }],
        finishReason: 'stop',
        usage: VAZIO,
        warnings: [],
      }
    }

    const text = textoDoUsuario(options.prompt)
    return {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'relay-process-message',
          toolName: TOOL,
          input: JSON.stringify({ text }),
        },
      ],
      finishReason: 'tool-calls',
      usage: VAZIO,
      warnings: [],
    }
  }

  async doStream(options: { prompt: readonly PromptMsg[] }): Promise<{
    stream: ReadableStream<{
      type: string
      [key: string]: unknown
    }>
  }> {
    const gerado = await this.doGenerate(options)
    const partes: Array<{ type: string; [key: string]: unknown }> = [
      { type: 'stream-start', warnings: [] },
    ]

    for (const parte of gerado.content) {
      if (parte.type === 'tool-call') {
        partes.push({ type: 'tool-input-start', id: parte.toolCallId, toolName: parte.toolName })
        partes.push({ type: 'tool-input-delta', id: parte.toolCallId, delta: parte.input })
        partes.push({ type: 'tool-input-end', id: parte.toolCallId })
        partes.push(parte)
      } else {
        partes.push({ type: 'text-start', id: 'relay-text' })
        partes.push({ type: 'text-delta', id: 'relay-text', delta: parte.text })
        partes.push({ type: 'text-end', id: 'relay-text' })
      }
    }

    partes.push({ type: 'finish', usage: gerado.usage, finishReason: gerado.finishReason })

    return {
      stream: new ReadableStream({
        start(controller) {
          for (const parte of partes) controller.enqueue(parte)
          controller.close()
        },
      }),
    }
  }
}

export function createStudioRelayModel(): MastraModelConfig {
  return new StudioRelayModel() as MastraModelConfig
}

function textoDoUsuario(prompt: readonly PromptMsg[]): string {
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const msg = prompt[i]
    if (msg === undefined || msg.role !== 'user') continue
    const content = msg.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) continue
    return content
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text ?? '')
      .join('\n')
  }
  return ''
}

function textoDoToolResult(prompt: readonly PromptMsg[]): string | undefined {
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const msg = prompt[i]
    if (msg === undefined) continue
    const content = msg.content
    if (!Array.isArray(content)) continue
    for (const parte of content) {
      if (parte.type !== 'tool-result') continue
      const saida = extrairTexto(parte.output ?? parte.result)
      if (saida !== undefined) return saida
    }
  }
  return undefined
}

function extrairTexto(valor: unknown): string | undefined {
  if (typeof valor === 'string') return valor
  if (valor === null || typeof valor !== 'object') return undefined
  const row = valor as { type?: string; value?: unknown; text?: unknown }
  if (row.type === 'text' && typeof row.value === 'string') return row.value
  if (row.type === 'json') {
    const v = row.value
    if (v !== null && typeof v === 'object' && 'text' in v && typeof v.text === 'string') {
      return v.text
    }
    return JSON.stringify(v)
  }
  if (typeof row.text === 'string') return row.text
  return undefined
}
