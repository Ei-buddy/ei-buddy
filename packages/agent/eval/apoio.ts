import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InMemoryConfirmations } from '../src/confirmations.js'
import { InMemoryConversationStore } from '../src/conversations.js'
import { createAgentRuntime } from '../src/create-runtime.js'
import { processMessage } from '../src/process-message.js'
import { contemTermoTecnico } from '../src/technical-terms.js'
import { AGORA, criarLojaDeTeste, type LojaDeTeste } from '../src/test-support/loja-de-teste.js'

/**
 * Avaliação com o modelo real — fora da CI (research §12).
 *
 * Cada conversa roda contra `AGENT_MODEL` sobre uma loja em memória. As
 * asserções são determinísticas; a transcrição fica em `eval/.transcricoes/`
 * para leitura humana do tom e vai anexada ao PR de liberação.
 */

export const CHAVE = process.env.OPENAI_API_KEY
export const MODELO = process.env.AGENT_MODEL ?? 'openai/gpt-5.4-mini'
export const semChave = CHAVE === undefined || CHAVE.trim() === ''

const PEER = '5511999990000'

export type Turno = {
  readonly dona: string
  readonly buddy: string
  readonly kind: string
  /** Tempo de resposta medido (SC-007: meta, não bloqueio). */
  readonly ms: number
}

export type Conversa = {
  readonly loja: LojaDeTeste
  readonly turnos: Turno[]
  enviar(texto: string): Promise<Turno>
  salvar(nome: string): void
}

export function novaConversa(loja: LojaDeTeste = criarLojaDeTeste()): Conversa {
  const runtime = createAgentRuntime({
    model: { id: MODELO as `${string}/${string}`, apiKey: CHAVE ?? '' },
    useCases: loja.useCases,
    confirmations: new InMemoryConfirmations(),
    conversations: new InMemoryConversationStore(),
    peers: { resolve: async () => ({ companyId: 'emp-A', userId: 'user-A', role: 'owner' }) },
  })
  const turnos: Turno[] = []
  let minuto = 0

  return {
    loja,
    turnos,
    async enviar(texto) {
      minuto += 1
      const inicio = performance.now()
      const r = await processMessage(runtime, {
        text: texto,
        requestId: `eval-${minuto}`,
        now: new Date(AGORA.getTime() + minuto * 60_000),
        channel: 'whatsapp',
        peer: PEER,
      })
      const turno = {
        dona: texto,
        buddy: r.text,
        kind: r.kind,
        ms: Math.round(performance.now() - inicio),
      }
      turnos.push(turno)
      return turno
    },
    salvar(nome) {
      const pasta = join(dirname(fileURLToPath(import.meta.url)), '.transcricoes')
      mkdirSync(pasta, { recursive: true })
      const corpo = [
        `# ${nome}`,
        '',
        `Modelo: ${MODELO}`,
        '',
        ...turnos.flatMap((t) => [
          `**Dona:** ${t.dona}`,
          '',
          `**Buddy** (${t.kind}, ${(t.ms / 1000).toFixed(1)} s): ${t.buddy}`,
          '',
        ]),
        `Gravações: ${JSON.stringify(loja.gravacoes.map((g) => g.acao))}`,
      ].join('\n')
      writeFileSync(join(pasta, `${nome}.md`), corpo)
    },
  }
}

/** Sem UUID, `PROD-…`, centavos nem identificador camelCase. */
export function semTermoTecnico(texto: string): boolean {
  return !contemTermoTecnico(texto, new Set()) && !/\b[a-z]+[A-Z][A-Za-z]*\b/.test(texto)
}

/** Linhas de texto corrido (itens de lista não contam). */
export function linhasCorridas(texto: string): number {
  return texto.split('\n').filter((l) => l.trim() !== '' && !/^\s*(?:[-*•]|\d+[.)])\s/.test(l))
    .length
}
