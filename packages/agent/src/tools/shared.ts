import { RequestContext } from '@mastra/core/request-context'
import { isAppError, type ExecutionContext, type PendingConfirmation } from '@na-regua/core'
import type {
  EntidadeDaConversa,
  IntencaoEmAndamento,
  ResumoDeEntidades,
  SnapshotDeTurno,
} from '../conversation-context.js'
import { erroHumano, type Recusado } from '../views.js'

/** Chave única no `RequestContext`. O estado do turno nunca vai ao prompt. */
export const CHAVE_DO_TURNO = 'buddy.turno'

/**
 * O que uma mensagem sabe enquanto o agente raciocina.
 *
 * `execucao` vem do peer ou da sessão, resolvido por `processMessage`. Nenhuma
 * tool aceita empresa, usuário ou papel como argumento do modelo.
 */
export type EstadoDoTurno = {
  readonly execucao: ExecutionContext
  /** Mensagem atual da dona, já juntada pela rajada. Usada pela trava do aceite. */
  readonly textoDaDona: string
  readonly resumo: ResumoDeEntidades
  readonly pendente?: PendingConfirmation
  readonly coletor: ColetorDoTurno
  readonly conversationKey: string
  readonly ttlMs: number
}

/** Acumula o que o turno tocou, para o snapshot e para a resposta. */
export class ColetorDoTurno {
  private readonly entidades = new Map<string, EntidadeDaConversa>()
  intencao: IntencaoEmAndamento | undefined
  propostaNova: { readonly id: string } | undefined
  /** `accept_proposal` ou `cancel_proposal` decidiu a pendente neste turno. */
  decidiuPendente = false

  registrar(...entidades: readonly EntidadeDaConversa[]): void {
    for (const e of entidades) {
      if (e.rotulo.trim() === '' || e.ref === '') continue
      const chave = `${e.tipo}:${e.ref}`
      this.entidades.delete(chave)
      this.entidades.set(chave, e)
    }
  }

  snapshot(): SnapshotDeTurno {
    return {
      v: 2,
      entidades: [...this.entidades.values()],
      ...(this.intencao === undefined ? {} : { intencao: this.intencao }),
      ...(this.propostaNova === undefined ? {} : { propostaId: this.propostaNova.id }),
    }
  }
}

export function contextoDoTurno(estado: EstadoDoTurno): RequestContext {
  const rc = new RequestContext()
  rc.setRaw(CHAVE_DO_TURNO, estado)
  return rc
}

type ComRequestContext = { readonly requestContext?: { getRaw(chave: string): unknown } }

export function turnoDe(context: unknown): EstadoDoTurno {
  const estado = (context as ComRequestContext | undefined)?.requestContext?.getRaw(CHAVE_DO_TURNO)
  if (estado === undefined) {
    throw new Error('Tool do Buddy chamada fora de um turno: falta o estado no RequestContext.')
  }
  return estado as EstadoDoTurno
}

/** O modelo manda `null` em opcional, inclusive aninhado; o schema espera ausência. */
export function semNulos(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semNulos)
  if (typeof valor !== 'object' || valor === null) return valor
  const limpo: Record<string, unknown> = {}
  for (const [chave, v] of Object.entries(valor)) {
    if (v === null) continue
    limpo[chave] = semNulos(v)
  }
  return limpo
}

/** `AppError` vira recusa humana; outra exceção sobe para a frase fixa de falha. */
export async function emErroHumano<T>(fn: () => Promise<T>): Promise<T | Recusado> {
  try {
    return await fn()
  } catch (erro) {
    if (isAppError(erro)) return erroHumano(erro)
    throw erro
  }
}
