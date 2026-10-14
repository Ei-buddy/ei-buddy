import type { CancelTitleInput, PayableOutput, UpdatePayableInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { PayableTransaction, PayableUnitOfWork } from '../ports/payable-repository.js'

export type ChangePayableDeps = {
  readonly uow: PayableUnitOfWork
}

/**
 * O titulo que ainda pode mudar — NR-150.
 *
 * So o que nao teve dinheiro nenhum. Com baixa, a conta ja virou caixa: mudar o
 * valor ou cancelar por cima de um pagamento deixaria o extrato dizendo uma
 * coisa e o titulo outra. O caminho e estornar a baixa (que ja existe) e, ai
 * sim, corrigir. Cancelado nao volta: cancelar e o fim do titulo.
 */
async function tituloMutavel(
  tx: PayableTransaction,
  ctx: ExecutionContext,
  id: string,
): Promise<PayableOutput> {
  const titulo = await tx.findById(ctx.companyId, id)
  if (titulo === null) throw AppError.notFound('Conta a pagar não encontrada.')
  if (titulo.status === 'cancelled') {
    throw AppError.conflict('Esta conta já foi cancelada.')
  }
  if (titulo.settledAmountCents > 0) {
    throw AppError.conflict(
      'Esta conta já tem pagamento registrado. Estorne a baixa antes de corrigir ou cancelar.',
    )
  }
  return titulo
}

/** Corrige uma conta a pagar lancada errado — NR-150. */
export async function updatePayable(
  deps: ChangePayableDeps,
  ctx: ExecutionContext,
  id: string,
  input: UpdatePayableInput,
): Promise<PayableOutput> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const antes = await tituloMutavel(tx, ctx, id)
    const depois = await tx.update(ctx.companyId, id, input)

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Payable',
      entityId: id,
      action: 'updated',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: {
        supplier: antes.supplier,
        description: antes.description,
        amountCents: antes.amountCents,
        dueDate: antes.dueDate,
      },
      after: { ...input },
    })

    return depois
  })
}

/** Cancela uma conta a pagar que nao vai mais ser paga — NR-150. */
export async function cancelPayable(
  deps: ChangePayableDeps,
  ctx: ExecutionContext,
  id: string,
  input: CancelTitleInput,
): Promise<PayableOutput> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const antes = await tituloMutavel(tx, ctx, id)
    const depois = await tx.cancel(ctx.companyId, id, ctx.userId, ctx.now)

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Payable',
      entityId: id,
      action: 'cancelled',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: { status: antes.status, amountCents: antes.amountCents },
      after: { status: 'cancelled', reason: input.reason },
    })

    return depois
  })
}
