import type { CancelTitleInput, ReceivableOutput, UpdateReceivableInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type {
  ManualReceivableTransaction,
  ManualReceivableUnitOfWork,
  ReceivableForChange,
} from '../ports/receivable-repository.js'

export type ChangeReceivableDeps = {
  readonly uow: ManualReceivableUnitOfWork
}

/**
 * O recebivel que ainda pode mudar — NR-150.
 *
 * So o AVULSO, lancado a mao. O que nasceu de uma venda se resolve na venda
 * (cancelar ou devolver): mexer nele aqui deixaria a venda dizendo um valor e o
 * financeiro outro. E so sem baixa, pelo mesmo motivo das contas a pagar.
 */
async function recebivelMutavel(
  tx: ManualReceivableTransaction,
  ctx: ExecutionContext,
  id: string,
): Promise<ReceivableForChange> {
  const achado = await tx.findForChange(ctx.companyId, id)
  if (achado === null) throw AppError.notFound('Conta a receber não encontrada.')
  const r = achado.receivable
  if (r.saleId !== null) {
    throw AppError.conflict(
      'Este recebível veio de uma venda. Para mudar, cancele ou devolva a venda.',
    )
  }
  if (r.status === 'cancelled') throw AppError.conflict('Esta conta já foi cancelada.')
  if (r.settledAmountCents > 0) {
    throw AppError.conflict(
      'Esta conta já tem recebimento registrado. Estorne a baixa antes de corrigir ou cancelar.',
    )
  }
  return achado
}

/** Corrige um recebivel avulso — NR-150. Divida do cliente acompanha no fiado. */
export async function updateReceivable(
  deps: ChangeReceivableDeps,
  ctx: ExecutionContext,
  id: string,
  input: UpdateReceivableInput,
): Promise<ReceivableOutput> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const { receivable: antes, isCustomerDebt } = await recebivelMutavel(tx, ctx, id)
    const depois = await tx.update(ctx.companyId, id, input)

    /* O fiado do cliente acompanha a diferenca, e nao o valor novo inteiro: o
       saldo dele soma outros titulos tambem. */
    if (isCustomerDebt && antes.customerId !== null && input.amountCents !== undefined) {
      const delta = input.amountCents - antes.amountCents
      if (delta !== 0) await tx.adjustCustomerBalance(antes.customerId, delta)
    }

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Receivable',
      entityId: id,
      action: 'updated',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: {
        description: antes.description,
        amountCents: antes.amountCents,
        dueDate: antes.dueDate,
      },
      after: { ...input },
    })

    return depois
  })
}

/** Cancela um recebivel avulso — NR-150. A divida sai do fiado do cliente. */
export async function cancelReceivable(
  deps: ChangeReceivableDeps,
  ctx: ExecutionContext,
  id: string,
  input: CancelTitleInput,
): Promise<ReceivableOutput> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const { receivable: antes, isCustomerDebt } = await recebivelMutavel(tx, ctx, id)
    const depois = await tx.cancel(ctx.companyId, id)

    if (isCustomerDebt && antes.customerId !== null) {
      await tx.adjustCustomerBalance(antes.customerId, -antes.amountCents)
    }

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Receivable',
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
