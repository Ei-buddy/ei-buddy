import type { Processor } from '@mastra/core/processors'

/**
 * Nada técnico chega à dona — FR-002, FR-004.
 *
 * Três camadas: as tools já devolvem visões humanizadas, a instrução proíbe,
 * e esta verificação barra o que ainda escapar. Primeiro pede ao modelo uma
 * reescrita (processador de saída, nativo do Mastra); se o termo persistir,
 * o trecho é retirado aqui, em código determinístico.
 */

export const TEXTO_SEM_RESPOSTA_LIMPA =
  'Não consegui montar a resposta direito. Pode repetir o pedido de outro jeito?'

const FEEDBACK_DE_REESCRITA =
  'Sua resposta mostrou um código interno, um nome de campo, o nome de uma ferramenta ou um valor em centavos. ' +
  'Reescreva a mesma resposta só com nomes, quantidades e valores em reais, sem nenhum código.'

const PADROES: readonly RegExp[] = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\bPROD-\d+\b/i,
  /\b[a-z][A-Za-z0-9]*Cents\b/,
  /\bcentavos?\b/i,
]

type ComZod = { readonly _zod?: { readonly def?: Record<string, unknown> } }

function chavesCamelCase(schema: unknown, achadas: Set<string>, vistos = new Set<unknown>()): void {
  if (schema === null || typeof schema !== 'object' || vistos.has(schema)) return
  vistos.add(schema)
  const def = (schema as ComZod)._zod?.def
  if (def === undefined) return

  for (const [chave, valor] of Object.entries(def)) {
    if (chave === 'shape' && valor !== null && typeof valor === 'object') {
      for (const [campo, filho] of Object.entries(valor)) {
        if (/[a-z][A-Z]/.test(campo)) achadas.add(campo)
        chavesCamelCase(filho, achadas, vistos)
      }
      continue
    }
    if (Array.isArray(valor)) {
      valor.forEach((v) => chavesCamelCase(v, achadas, vistos))
    } else {
      chavesCamelCase(valor, achadas, vistos)
    }
  }
}

/** Ids das tools e chaves camelCase dos seus schemas — o vocabulário interno. */
export function termosDasFerramentas(
  tools: Readonly<Record<string, { readonly id: string; readonly inputSchema?: unknown }>>,
): Set<string> {
  const termos = new Set<string>()
  for (const tool of Object.values(tools)) {
    termos.add(tool.id)
    chavesCamelCase(tool.inputSchema, termos)
  }
  return termos
}

export function contemTermoTecnico(texto: string, proibidos: ReadonlySet<string>): boolean {
  if (PADROES.some((p) => p.test(texto))) return true
  for (const palavra of texto.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (proibidos.has(palavra)) return true
  }
  return false
}

const ITEM_DE_LISTA = /^\s*(?:[-*•]|\d+[.)])\s/

/** Remove a frase ou o item de lista que ainda carrega termo técnico. */
export function limparTermosTecnicos(texto: string, proibidos: ReadonlySet<string>): string {
  if (!contemTermoTecnico(texto, proibidos)) return texto

  const linhas = texto
    .split('\n')
    .map((linha) => {
      if (!contemTermoTecnico(linha, proibidos)) return linha
      if (ITEM_DE_LISTA.test(linha)) return undefined
      const frases = linha.split(/(?<=[.!?])\s+/).filter((f) => !contemTermoTecnico(f, proibidos))
      return frases.length === 0 ? undefined : frases.join(' ')
    })
    .filter((l): l is string => l !== undefined)

  const limpo = linhas.join('\n').trim()
  return limpo === '' ? TEXTO_SEM_RESPOSTA_LIMPA : limpo
}

/** Processador de saída: uma reescrita pedida ao modelo quando o termo aparece. */
export function processadorSemTermoTecnico(proibidos: ReadonlySet<string>): {
  readonly id: string
  readonly processOutputStep: NonNullable<Processor['processOutputStep']>
} {
  return {
    id: 'sem-termo-tecnico',
    processOutputStep: async ({ text, abort, retryCount, messages }) => {
      if (text !== undefined && retryCount === 0 && contemTermoTecnico(text, proibidos)) {
        abort(FEEDBACK_DE_REESCRITA, { retry: true })
      }
      return messages
    },
  }
}
