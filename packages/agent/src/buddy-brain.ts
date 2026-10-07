import { Agent } from '@mastra/core/agent'
import type { Processor } from '@mastra/core/processors'
import type { ConfirmationStore, ExecutionContext, PendingConfirmation } from '@na-regua/core'
import type { AgentUseCases } from './catalog.js'
import {
  resumoComoTexto,
  type ResumoDeEntidades,
  type SnapshotDeTurno,
} from './conversation-context.js'
import { instrucoes } from './instructions.js'
import {
  limparTermosTecnicos,
  processadorSemTermoTecnico,
  termosDasFerramentas,
  TEXTO_SEM_RESPOSTA_LIMPA,
} from './technical-terms.js'
import { ferramentasDeAceite, TOOLS_DE_ACEITE } from './tools/acceptance-tools.js'
import { ferramentasDeProposta } from './tools/proposal-tools.js'
import { ferramentasDeLeitura } from './tools/read-tools.js'
import { ferramentasDeRecusa } from './tools/refusal-tools.js'
import { ColetorDoTurno, contextoDoTurno, turnoDe, type EstadoDoTurno } from './tools/shared.js'

/** No máximo 5 etapas de modelo por mensagem (FR-036). */
export const MAXIMO_DE_ETAPAS = 5

export type ConversarInput = {
  readonly execucao: ExecutionContext
  readonly conversationKey: string
  readonly texto: string
  /** 0..12 mensagens da conversa ativa, em ordem. */
  readonly janela: readonly {
    readonly role: 'user' | 'assistant' | 'system'
    readonly body: string
  }[]
  readonly resumo: ResumoDeEntidades
  readonly pendente?: PendingConfirmation
  /** Fatos que o laço quer que o modelo saiba neste turno (ex.: proposta venceu). */
  readonly avisos?: readonly string[]
  /** AAAA-MM-DD no fuso da loja. */
  readonly hoje: string
}

export type ConversarSaida = {
  readonly texto: string
  readonly etapas: number
  readonly snapshot: SnapshotDeTurno
  readonly propostaNova?: { readonly id: string }
  /** A pendente foi aceita ou cancelada por tool neste turno. */
  readonly decidiuPendente?: boolean
}

export type BuddyBrain = {
  conversar(input: ConversarInput): Promise<ConversarSaida>
}

type ModeloDoAgente = ConstructorParameters<typeof Agent>[0]['model']

export type CreateBuddyBrainOptions = {
  /** String do registro do Mastra (`openai/gpt-5.4-mini`) ou modelo dublê nos testes. */
  readonly model: ModeloDoAgente
  readonly useCases: AgentUseCases
  readonly confirmations: ConfirmationStore
  readonly ttlMs: number
}

const PEDE_CONFIRMACAO =
  /\b(pode|posso) (confirmar|registrar|gravar|lançar|lancar|fechar|cadastrar|seguir)\b|\bconfirm[ao]\?|\bme confirma\b|\bconfirma se\b|\bpreciso.{0,20}confirm|\bé isso\b|\bquer que eu (siga|registre|lance|feche|grave)\b/i

const FEEDBACK_SEM_PROPOSTA =
  'Você pediu confirmação sem chamar a ferramenta da proposta, e nada foi proposto. ' +
  'Chame agora a ferramenta do pedido (por exemplo, create_sale) com o que a dona disse; ' +
  'ela devolve a proposta ou o que falta.'

const FEEDBACK_SEM_TEXTO =
  'Você terminou sem responder nada. Responda à dona agora ou chame a ferramenta do pedido.'

/**
 * Etapa final que não serve à dona: vazia, ou "pode confirmar?" sem proposta
 * (o "pode" dela ficaria sem nada para aceitar). Uma nova tentativa pedida ao
 * modelo, como no termo técnico.
 */
function processadorDeRespostaUtil(): {
  readonly id: string
  readonly processOutputStep: NonNullable<Processor['processOutputStep']>
} {
  return {
    id: 'resposta-util',
    processOutputStep: async ({ text, toolCalls, abort, retryCount, messages, requestContext }) => {
      if (retryCount > 0 || (toolCalls?.length ?? 0) > 0) return messages
      if (text === undefined || text.trim() === '')
        return abort(FEEDBACK_SEM_TEXTO, { retry: true })
      if (!PEDE_CONFIRMACAO.test(text)) return messages
      const turno = turnoDe({ requestContext })
      if (turno.pendente === undefined && turno.coletor.propostaNova === undefined) {
        abort(FEEDBACK_SEM_PROPOSTA, { retry: true })
      }
      return messages
    },
  }
}

/** O modelo às vezes devolve a mesma resposta duas vezes coladas. */
function semRepeticao(texto: string): string {
  const metade = texto.length / 2
  if (!Number.isInteger(metade)) return texto
  const primeira = texto.slice(0, metade)
  return primeira === texto.slice(metade) ? primeira.trim() : texto
}

function textoDaPendente(fatos: string): string {
  return (
    `Há uma proposta aguardando a confirmação da dona: ${fatos}. ` +
    'Se ela concordar, chame accept_proposal. Se ela corrigir algum dado, chame de novo a ferramenta da proposta com o dado corrigido. ' +
    'Se ela recusar, chame cancel_proposal. Se ela mudar de assunto, responda o novo assunto.'
  )
}

/**
 * O agente do Buddy — um `Agent` Mastra de várias etapas (ADR-0010).
 *
 * As consultas rodam dentro do laço e o modelo redige a resposta a partir do
 * resultado. O estado do turno (empresa, texto da dona, pendente) viaja no
 * `RequestContext`, que não entra no prompt.
 */
export function createBuddyBrain(opcoes: CreateBuddyBrainOptions): BuddyBrain {
  const tools = {
    ...ferramentasDeLeitura(opcoes.useCases),
    ...ferramentasDeProposta(opcoes.useCases, opcoes.confirmations),
    ...ferramentasDeAceite(opcoes.useCases, opcoes.confirmations),
    ...ferramentasDeRecusa(),
  }

  const proibidos = termosDasFerramentas(tools)
  const semAceite = Object.keys(tools).filter(
    (id) => !(TOOLS_DE_ACEITE as readonly string[]).includes(id),
  )

  const agent = new Agent({
    id: 'buddy',
    name: 'Buddy',
    instructions: instrucoes(),
    model: opcoes.model,
    tools,
    outputProcessors: [processadorSemTermoTecnico(proibidos), processadorDeRespostaUtil()],
  })

  return {
    async conversar(input) {
      const coletor = new ColetorDoTurno()
      const estado: EstadoDoTurno = {
        execucao: input.execucao,
        textoDaDona: input.texto,
        resumo: input.resumo,
        ...(input.pendente === undefined ? {} : { pendente: input.pendente }),
        coletor,
        conversationKey: input.conversationKey,
        ttlMs: opcoes.ttlMs,
      }

      const mensagens = [
        ...input.janela.map((m) => ({ role: m.role, content: m.body })),
        { role: 'user' as const, content: input.texto },
      ]
      const sistema = [
        `Hoje é ${input.hoje}.`,
        resumoComoTexto(input.resumo),
        ...(input.pendente === undefined ? [] : [textoDaPendente(input.pendente.summary)]),
        ...(input.avisos ?? []),
      ].filter((s) => s !== '')

      const result = await agent.generate(mensagens as never, {
        maxSteps: MAXIMO_DE_ETAPAS,
        maxProcessorRetries: 1,
        requestContext: contextoDoTurno(estado),
        system: sistema,
        ...(input.pendente === undefined ? { activeTools: semAceite } : {}),
        /* A última etapa sai sem tool: o modelo diz o que entendeu e pergunta
           como seguir, em vez de travar ou de pedir uma sexta chamada (FR-036). */
        prepareStep: async ({ stepNumber }: { readonly stepNumber: number }) =>
          stepNumber >= MAXIMO_DE_ETAPAS - 1
            ? { toolChoice: 'none' as const, activeTools: [] }
            : undefined,
      })

      const texto = limparTermosTecnicos(semRepeticao(result.text.trim()), proibidos)

      return {
        /* Mensagem vazia não chega ao WhatsApp; a dona ficaria sem resposta. */
        texto: texto === '' ? TEXTO_SEM_RESPOSTA_LIMPA : texto,
        etapas: result.steps.length,
        snapshot: coletor.snapshot(),
        ...(coletor.propostaNova === undefined ? {} : { propostaNova: coletor.propostaNova }),
        ...(coletor.decidiuPendente ? { decidiuPendente: true } : {}),
      }
    },
  }
}
