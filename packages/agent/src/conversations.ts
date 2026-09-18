import { randomUUID } from 'node:crypto'
import type { ActiveContext, AppendTurn, ConversationStore, StoredMessage } from '@na-regua/core'

/** Idle padrao: 2 h. Nao apaga mensagens; so corta o recorte do decide. */
const IDLE_PADRAO_MS = 7_200_000
/** Default `window = 12` (RNF-075 / ADR-0016). Teto do recorte, nao expurgo. */
const JANELA_PADRAO = 12

type Fio = {
  readonly id: string
  readonly mensagens: StoredMessage[]
}

/**
 * Store in-memory do historico — so teste / runtime local sem Postgres.
 *
 * Mapas aninhados: empresa → chave da conversa → fio. Loja B na chave da A
 * nao le nem escreve a A. `loadActive` nao cria chave.
 */
export class InMemoryConversationStore implements ConversationStore {
  private readonly porEmpresa = new Map<string, Map<string, Fio>>()

  async loadActive(
    companyId: string,
    conversationKey: string,
    now: Date,
    options?: { readonly idleMs?: number; readonly window?: number },
  ): Promise<ActiveContext | undefined> {
    if (!identidadeValida(conversationKey)) return undefined

    const fio = this.porEmpresa.get(companyId)?.get(conversationKey)
    if (fio === undefined) return undefined

    const idleMs = options?.idleMs ?? IDLE_PADRAO_MS
    const janela = options?.window ?? JANELA_PADRAO
    const recorte = recorteVigente(fio.mensagens, now, idleMs, janela)

    return { conversationId: fio.id, ...recorte }
  }

  async append(companyId: string, turn: AppendTurn): Promise<void> {
    if (!identidadeValida(turn.conversationKey)) {
      throw new Error('InMemoryConversationStore recusou identidade vazia.')
    }

    let daEmpresa = this.porEmpresa.get(companyId)
    if (daEmpresa === undefined) {
      daEmpresa = new Map()
      this.porEmpresa.set(companyId, daEmpresa)
    }

    let fio = daEmpresa.get(turn.conversationKey)
    if (fio === undefined) {
      fio = { id: randomUUID(), mensagens: [] }
      daEmpresa.set(turn.conversationKey, fio)
    }

    fio.mensagens.push(mensagem('user', turn.userBody, turn.at, turn.toolCalls))
    fio.mensagens.push(mensagem('assistant', turn.assistantBody, turn.at))
  }
}

/**
 * Recorte ativo: se a ultima mensagem e mais velha que idleMs, nada vai ao
 * decide. Senao, so o trecho continuo apos o ultimo buraco >= idleMs
 * (recomeco), limitado a `janela`. Idle nao apaga.
 */
function recorteVigente(
  mensagens: readonly StoredMessage[],
  now: Date,
  idleMs: number,
  janela: number,
): { idle: true; messages: [] } | { idle: false; messages: StoredMessage[] } {
  const ultima = mensagens[mensagens.length - 1]
  if (ultima === undefined) {
    return { idle: false, messages: [] }
  }
  if (ultima.createdAt.getTime() <= now.getTime() - idleMs) {
    return { idle: true, messages: [] }
  }

  const doMaisNovo: StoredMessage[] = []
  for (let i = mensagens.length - 1; i >= 0 && doMaisNovo.length < janela; i--) {
    const atual = mensagens[i]
    if (atual === undefined) break
    const vizinhaMaisNova = doMaisNovo[doMaisNovo.length - 1]
    if (
      vizinhaMaisNova !== undefined &&
      vizinhaMaisNova.createdAt.getTime() - atual.createdAt.getTime() >= idleMs
    ) {
      break
    }
    doMaisNovo.push(atual)
  }
  return { idle: false, messages: doMaisNovo.reverse() }
}

function mensagem(
  role: 'user' | 'assistant',
  body: string,
  createdAt: Date,
  toolCalls?: unknown,
): StoredMessage {
  return {
    id: randomUUID(),
    role,
    body,
    createdAt,
    ...(toolCalls === undefined ? {} : { toolCalls }),
  }
}

/**
 * Espelho local do parse de `db/conversation-identity` — `agent` nao importa
 * `db`. Interlocutor vazio, prefixo desconhecido ou chave curta demais
 * falham fechado.
 */
function identidadeValida(conversationKey: string): boolean {
  const partes = conversationKey.split(':')
  if (partes.length < 3) return false
  const prefixo = partes[0]
  if (prefixo !== 'app' && prefixo !== 'wa') return false
  return partes.slice(2).join(':').trim() !== ''
}
