import type { CrmCardOutput, CrmCommentOutput, TeamMemberOutput } from '@na-regua/contracts'
import type { CompanyId } from '../context.js'
import type { CrmRepository, NewCrmCard, NewCrmComment } from '../ports/crm-repository.js'
import type { TeamRepository } from '../ports/team-repository.js'

/**
 * CRM em memoria, para teste dos casos de uso.
 *
 * Aplica o filtro por empresa de verdade — como as outras portas falsas do
 * repositorio: um caso de uso que esquecesse `companyId` passaria no teste e
 * vazaria dado em producao.
 */
export class InMemoryCrm implements CrmRepository {
  private readonly cards = new Map<string, CrmCardOutput & { companyId: CompanyId }>()
  private readonly comments = new Map<string, (CrmCommentOutput & { companyId: CompanyId })[]>()
  private sequenciaCard = 0
  private sequenciaComentario = 0

  /** Nomes conhecidos, so para o falso devolver `customerName`/`assigneeName` coerentes. */
  readonly clientes = new Map<string, string>()
  readonly usuarios = new Map<string, string>()

  async create(card: NewCrmCard): Promise<CrmCardOutput> {
    this.sequenciaCard += 1
    const gravado = {
      id: `crm-${this.sequenciaCard}`,
      companyId: card.companyId,
      title: card.title,
      description: card.description ?? null,
      kind: card.kind,
      column: 'todo' as const,
      customerId: card.customerId ?? null,
      customerName:
        card.customerId === undefined ? null : (this.clientes.get(card.customerId) ?? null),
      dueOn: card.dueOn,
      assigneeUserId: card.assigneeUserId ?? null,
      assigneeName:
        card.assigneeUserId === undefined ? null : (this.usuarios.get(card.assigneeUserId) ?? null),
      comments: [],
      createdAt: card.createdAt.toISOString(),
    }
    this.cards.set(gravado.id, gravado)
    this.comments.set(gravado.id, [])
    return this.semTenant(gravado)
  }

  async list(companyId: CompanyId): Promise<readonly CrmCardOutput[]> {
    return (
      [...this.cards.values()]
        .filter((c) => c.companyId === companyId)
        /* Do mais recente para o mais antigo — como a porta promete. */
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((c) => this.semTenant(c))
    )
  }

  async findById(companyId: CompanyId, cardId: string): Promise<CrmCardOutput | undefined> {
    const achado = this.cards.get(cardId)
    return achado?.companyId === companyId ? this.semTenant(achado) : undefined
  }

  async move(companyId: CompanyId, cardId: string, column: CrmCardOutput['column']) {
    const atual = this.cards.get(cardId)
    if (atual === undefined || atual.companyId !== companyId) {
      throw new Error(`card ${cardId} nao encontrado para a empresa ${companyId}`)
    }
    const movido = { ...atual, column }
    this.cards.set(cardId, movido)
    return this.semTenant(movido)
  }

  async delete(companyId: CompanyId, cardId: string): Promise<boolean> {
    const atual = this.cards.get(cardId)
    if (atual === undefined || atual.companyId !== companyId) return false
    this.cards.delete(cardId)
    this.comments.delete(cardId)
    return true
  }

  async addComment(comment: NewCrmComment): Promise<CrmCommentOutput> {
    const card = this.cards.get(comment.cardId)
    if (card === undefined || card.companyId !== comment.companyId) {
      throw new Error(`card ${comment.cardId} nao encontrado para a empresa ${comment.companyId}`)
    }

    this.sequenciaComentario += 1
    const gravado = {
      id: `crmc-${this.sequenciaComentario}`,
      companyId: comment.companyId,
      authorId: comment.authorId,
      authorName: this.usuarios.get(comment.authorId) ?? null,
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
    }

    const lista = this.comments.get(comment.cardId) ?? []
    lista.push(gravado)
    this.comments.set(comment.cardId, lista)

    /* O card em memoria carrega a lista de comentarios embutida — mantida em
       sincronia aqui, como a leitura de verdade faz com um JOIN. */
    this.cards.set(comment.cardId, {
      ...card,
      comments: [...lista.map((c) => this.semTenant(c))],
    })

    return this.semTenant(gravado)
  }

  private semTenant<T extends { companyId: CompanyId }>(registro: T): Omit<T, 'companyId'> {
    const { companyId: _omitido, ...resto } = registro
    return resto
  }
}

export class InMemoryTeam implements TeamRepository {
  private readonly membros = new Map<string, (TeamMemberOutput & { companyId: CompanyId })[]>()

  adicionar(companyId: CompanyId, membro: TeamMemberOutput): void {
    const lista = this.membros.get(companyId) ?? []
    lista.push({ ...membro, companyId })
    this.membros.set(companyId, lista)
  }

  async list(companyId: CompanyId): Promise<readonly TeamMemberOutput[]> {
    return (this.membros.get(companyId) ?? []).map(({ companyId: _omitido, ...resto }) => resto)
  }
}
