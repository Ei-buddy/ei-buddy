import type {
  CreateFixedCostInput,
  FixedCostOutput,
  UpdateFixedCostInput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { FixedCostRepository } from '../ports/fixed-cost-repository.js'

export type FixedCostDeps = {
  readonly fixedCosts: FixedCostRepository
  readonly audit: AuditTrail
}

/** Lista os custos fixos — a tela de plano de contas. Leitura, sem guarda de papel. */
export async function listFixedCosts(
  deps: FixedCostDeps,
  ctx: ExecutionContext,
): Promise<readonly FixedCostOutput[]> {
  return deps.fixedCosts.list(ctx.companyId)
}

/** Cadastra um custo fixo — NR-110. */
export async function createFixedCost(
  deps: FixedCostDeps,
  ctx: ExecutionContext,
  input: CreateFixedCostInput,
): Promise<FixedCostOutput> {
  assertCanWrite(ctx)

  const custo = await deps.fixedCosts.insert({
    companyId: ctx.companyId,
    name: input.name,
    amountCents: input.amountCents,
    dueDay: input.dueDay,
    accountId: input.accountId ?? null,
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'FixedCost',
    entityId: custo.id,
    action: 'created',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { name: custo.name, amountCents: custo.amountCents, dueDay: custo.dueDay },
  })

  return custo
}

/** Edita um custo fixo — redefine por completo, como o formulario pede. */
export async function updateFixedCost(
  deps: FixedCostDeps,
  ctx: ExecutionContext,
  id: string,
  input: UpdateFixedCostInput,
): Promise<FixedCostOutput> {
  assertCanWrite(ctx)

  const atual = await deps.fixedCosts.findById(ctx.companyId, id)
  if (atual === undefined) throw AppError.notFound('Custo fixo não encontrado.')

  const custo = await deps.fixedCosts.update(ctx.companyId, id, {
    name: input.name,
    amountCents: input.amountCents,
    dueDay: input.dueDay,
    accountId: input.accountId ?? null,
  })

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'FixedCost',
    entityId: custo.id,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { name: atual.name, amountCents: atual.amountCents, dueDay: atual.dueDay },
    after: { name: custo.name, amountCents: custo.amountCents, dueDay: custo.dueDay },
  })

  return custo
}

/**
 * Exclui um custo fixo.
 *
 * Sem guarda de "tem conta gerada": apagar o molde nao apaga nem reclassifica
 * o que ja foi lancado (a FK e `ON DELETE SET NULL`) — "contas ja lancadas
 * continuam como estao" e a propria promessa da tela.
 */
export async function deleteFixedCost(
  deps: FixedCostDeps,
  ctx: ExecutionContext,
  id: string,
): Promise<void> {
  assertCanWrite(ctx)

  const custo = await deps.fixedCosts.findById(ctx.companyId, id)
  if (custo === undefined) throw AppError.notFound('Custo fixo não encontrado.')

  await deps.fixedCosts.remove(ctx.companyId, id)

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'FixedCost',
    entityId: custo.id,
    action: 'deleted',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { name: custo.name, amountCents: custo.amountCents },
    after: null,
  })
}
