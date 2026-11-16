import type {
  SupportInboxCounts,
  SupportInboxDetail,
  SupportInboxItem,
  SupportInboxSituation,
} from '@na-regua/contracts'
import type { UserId } from '../context.js'
import type { SupportInbox } from '../ports/support-inbox.js'

/**
 * Fila da plataforma em memoria — NR-215. As mesmas regras do SQL: a situacao
 * sai de quem falou por ultimo, responder reabre, e so Super Admin atravessa.
 */
export class InMemorySupportInbox implements SupportInbox {
  private readonly chamados = new Map<string, SupportInboxDetail>()
  private seq = 0

  constructor(private readonly admins: ReadonlySet<string> = new Set()) {}

  cadastrar(chamado: Omit<SupportInboxDetail, 'lastAuthor' | 'messagesCount'>): void {
    this.chamados.set(chamado.id, this.comDerivados(chamado))
  }

  private comDerivados(
    c: Omit<SupportInboxDetail, 'lastAuthor' | 'messagesCount'>,
  ): SupportInboxDetail {
    return {
      ...c,
      lastAuthor: c.messages.at(-1)?.author ?? null,
      messagesCount: c.messages.length,
    }
  }

  private conferir(quem: UserId): void {
    if (!this.admins.has(quem)) throw new Error('Somente Super Admin ve os chamados da plataforma.')
  }

  private situacao(c: SupportInboxItem): Exclude<SupportInboxSituation, 'todos'> {
    if (c.status === 'closed') return 'encerrados'
    return c.lastAuthor === 'suporte' ? 'aguardando' : 'responder'
  }

  async counts(requestedBy: UserId): Promise<SupportInboxCounts> {
    this.conferir(requestedBy)
    const todos = [...this.chamados.values()]
    const de = (s: string) => todos.filter((c) => this.situacao(c) === s).length
    return {
      toAnswer: de('responder'),
      awaitingCustomer: de('aguardando'),
      closed: de('encerrados'),
    }
  }

  async list(
    requestedBy: UserId,
    f: { situacao: SupportInboxSituation; limite: number; offset: number },
  ) {
    this.conferir(requestedBy)
    const casam = [...this.chamados.values()]
      .filter((c) => f.situacao === 'todos' || this.situacao(c) === f.situacao)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return {
      total: casam.length,
      tickets: casam.slice(f.offset, f.offset + f.limite).map(({ messages: _, ...c }) => c),
    }
  }

  async find(requestedBy: UserId, ticketId: string) {
    this.conferir(requestedBy)
    return this.chamados.get(ticketId)
  }

  async reply(requestedBy: UserId, ticketId: string, body: string) {
    this.conferir(requestedBy)
    const c = this.chamados.get(ticketId)
    if (c === undefined) return false
    this.seq += 1
    const agora = new Date(Date.parse(c.updatedAt) + this.seq * 1000).toISOString()
    this.chamados.set(
      ticketId,
      this.comDerivados({
        ...c,
        status: 'open',
        updatedAt: agora,
        messages: [
          ...c.messages,
          {
            id: `resp-${this.seq}`,
            author: 'suporte',
            authorName: 'Suporte EiBuddy',
            body: body.trim(),
            attachment: null,
            createdAt: agora,
          },
        ],
      }),
    )
    return true
  }

  async close(requestedBy: UserId, ticketId: string) {
    this.conferir(requestedBy)
    const c = this.chamados.get(ticketId)
    if (c === undefined) return false
    this.chamados.set(ticketId, { ...c, status: 'closed' })
    return true
  }
}
