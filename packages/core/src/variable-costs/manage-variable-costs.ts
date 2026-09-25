import type { CreateVariableCostInput, VariableCostOutput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { VariableCostRepository } from '../ports/variable-cost-repository.js'

/**
 * Custos variaveis — Topico 6 do TXT.
 *
 * Sem edicao, de proposito: um custo variavel e um nome e um numero. Mudar a
 * tarifa do cartao e excluir a antiga e lancar a nova, e a trilha de auditoria
 * guarda as duas.
 */
export type VariableCostDeps = {
  readonly variableCosts: VariableCostRepository
  readonly audit: AuditTrail
}

/** Leitura, sem guarda de papel: a tela de produto usa para mostrar a margem. */
export async function listVariableCosts(
  deps: VariableCostDeps,
  ctx: ExecutionContext,
): Promise<readonly VariableCostOutput[]> {
  return deps.variableCosts.list(ctx.companyId)
}

export async function createVariableCost(
  deps: VariableCostDeps,
  ctx: ExecutionContext,
  input: CreateVariableCostInput,
): Promise<VariableCostOutput> {
  assertCanWrite(ctx)

  const custo = await deps.variableCosts.insert({
    companyId: ctx.companyId,
    name: input.name,
    /* Arredondado UMA vez, aqui na entrada: 3.555 vira 3,56%. */
    rateBps: Math.round(input.ratePercent * 100),
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'VariableCost',
    entityId: custo.id,
    action: 'created',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { name: custo.name, ratePercent: custo.ratePercent },
  })

  return custo
}

export async function deleteVariableCost(
  deps: VariableCostDeps,
  ctx: ExecutionContext,
  id: string,
): Promise<void> {
  assertCanWrite(ctx)

  const custo = await deps.variableCosts.findById(ctx.companyId, id)
  if (custo === undefined) throw AppError.notFound('Custo variavel nao encontrado.')

  await deps.variableCosts.remove(ctx.companyId, id)

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'VariableCost',
    entityId: custo.id,
    action: 'deleted',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { name: custo.name, ratePercent: custo.ratePercent },
    after: null,
  })
}
