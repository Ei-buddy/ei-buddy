import type {
  CreateCrmCardInput,
  CrmBoardOutput,
  CrmCardOutput,
  CrmColumn,
  CrmCommentOutput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { CrmRepository } from '../ports/crm-repository.js'
import type { TeamRepository } from '../ports/team-repository.js'

export type CrmDeps = {
  readonly crm: CrmRepository
  /** Trilha — RF-123. Opcional para os testes de regra; a composicao entrega. */
  readonly audit?: AuditTrail
}

/** O card na trilha: titulo e coluna, que e o que alguem pergunta depois. */
async function auditarCard(
  deps: CrmDeps,
  ctx: ExecutionContext,
  cardId: string,
  action: 'created' | 'updated',
  after: Record<string, unknown>,
): Promise<void> {
  await deps.audit?.record({
    companyId: ctx.companyId,
    entity: 'CrmCard',
    entityId: cardId,
    action,
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after,
  })
}

/**
 * Cria um card — NR-109.
 *
 * Todo card nasce por aqui: nao ha sincronizacao automatica com Clientes nem
 * Financeiro neste recorte (ver a migration 0011). Um contato anotado antes
 * de o cliente ter cadastro entra sem `customerId` — o campo e opcional de
 * proposito, para nao travar quem esta registrando algo agora.
 */
export async function createCrmCard(
  deps: CrmDeps,
  ctx: ExecutionContext,
  input: CreateCrmCardInput,
): Promise<CrmCardOutput> {
  assertCanWrite(ctx)

  const card = await deps.crm.create({
    companyId: ctx.companyId,
    title: input.title,
    description: input.description,
    kind: input.kind,
    customerId: input.customerId,
    dueOn: input.dueOn,
    assigneeUserId: input.assigneeUserId,
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })

  await auditarCard(deps, ctx, card.id, 'created', { title: card.title, column: card.column })
  return card
}

/**
 * O quadro inteiro.
 *
 * Leitura: nao passa por `assertCanWrite`. `accountant` acompanha cobranca
 * (card do tipo `task` sobre um titulo vencido) como qualquer um.
 */
export async function listCrmBoard(deps: CrmDeps, ctx: ExecutionContext): Promise<CrmBoardOutput> {
  return { cards: [...(await deps.crm.list(ctx.companyId))] }
}

/**
 * Move o card entre colunas.
 *
 * "Concluir" um card e so move-lo para a coluna `done`: nao ha um segundo
 * verbo para isso porque a tela representa os dois com o mesmo gesto
 * (arrastar), e um caso de uso a mais para o mesmo movimento so divergiria
 * depois.
 */
export async function moveCrmCard(
  deps: CrmDeps,
  ctx: ExecutionContext,
  cardId: string,
  column: CrmColumn,
): Promise<CrmCardOutput> {
  assertCanWrite(ctx)

  const existe = await deps.crm.findById(ctx.companyId, cardId)
  if (existe === undefined) {
    /* 404, nunca 403: um erro diferente de "nao existe" confirmaria, para
       quem varre ids, que aquele card existe em alguma outra loja. */
    throw AppError.notFound('Card não encontrado.')
  }

  const movido = await deps.crm.move(ctx.companyId, cardId, column)
  await auditarCard(deps, ctx, cardId, 'updated', { column, from: existe.column })
  return movido
}

/**
 * Comenta num card.
 *
 * `accountant` pode comentar: e leitura de negocio (nao mexe em dinheiro nem
 * em cadastro), e o motivo de existir e justamente registrar acompanhamento —
 * travar isso para quem so tem papel de leitura contradiria o proprio
 * proposito do comentario.
 */
export async function commentOnCrmCard(
  deps: CrmDeps,
  ctx: ExecutionContext,
  cardId: string,
  text: string,
): Promise<CrmCommentOutput> {
  const existe = await deps.crm.findById(ctx.companyId, cardId)
  if (existe === undefined) {
    throw AppError.notFound('Card não encontrado.')
  }

  const comentario = await deps.crm.addComment({
    companyId: ctx.companyId,
    cardId,
    authorId: ctx.userId,
    text,
    createdAt: ctx.now,
  })
  /* So que houve comentario: o texto fica no card, e pode citar dado pessoal. */
  await auditarCard(deps, ctx, cardId, 'updated', { comentario: true })
  return comentario
}

export type TeamDeps = {
  readonly team: TeamRepository
}

/** Quem pode ser responsavel por um card — para o seletor da tela. */
export async function listTeam(deps: TeamDeps, ctx: ExecutionContext) {
  return { members: [...(await deps.team.list(ctx.companyId))] }
}
