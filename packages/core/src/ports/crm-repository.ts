import type { CrmCardOutput, CrmCardKind, CrmColumn, CrmCommentOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/**
 * Porta do quadro de CRM — NR-109.
 *
 * `companyId` em toda assinatura por decisao, nao por descuido: o isolamento
 * entre empresas nao pode depender de quem chama lembrar de filtrar. Ver a
 * mesma nota nas outras portas de cadastro.
 */

export type NewCrmCard = {
  readonly companyId: CompanyId
  readonly title: string
  readonly description?: string | undefined
  readonly kind: CrmCardKind
  readonly customerId?: string | undefined
  readonly dueOn: string
  readonly assigneeUserId?: string | undefined
  readonly createdBy: UserId
  readonly createdAt: Date
}

export type NewCrmComment = {
  readonly companyId: CompanyId
  readonly cardId: string
  readonly authorId: UserId
  readonly text: string
  readonly createdAt: Date
}

export type CrmRepository = {
  create(card: NewCrmCard): Promise<CrmCardOutput>

  /**
   * O quadro inteiro — ver `crmBoardOutputSchema` sobre o porque de nao
   * paginar. Ordenado do mais recente para o mais antigo.
   */
  list(companyId: CompanyId): Promise<readonly CrmCardOutput[]>

  /** `undefined` quando nao existe OU e de outra empresa — nunca 403. */
  findById(companyId: CompanyId, cardId: string): Promise<CrmCardOutput | undefined>

  /** Move para outra coluna. Lanca quando o card nao existe nesta empresa. */
  move(companyId: CompanyId, cardId: string, column: CrmColumn): Promise<CrmCardOutput>

  /** Lanca quando o card nao existe nesta empresa. */
  addComment(comment: NewCrmComment): Promise<CrmCommentOutput>

  /**
   * Apaga o card e os comentarios dele (CASCADE) — NR-213. `false` quando nao
   * existia nesta empresa.
   */
  delete(companyId: CompanyId, cardId: string): Promise<boolean>
}
