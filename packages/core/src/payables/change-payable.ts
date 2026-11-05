import type { CancelTitleInput, PayableOutput, UpdatePayableInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { PayableTransaction, PayableUnitOfWork } from '../ports/payable-repository.js'
import type { ChartOfAccountsRepository } from '../ports/chart-of-accounts.js'

export type ChangePayableDeps = {
  readonly uow: PayableUnitOfWork
  /** Para conferir que o plano de conta e DESTA loja. A api sempre liga. */
  readonly accounts?: Pick<ChartOfAccountsRepository, 'findById'>
}

/** Existe e nao foi cancelado — o minimo para mexer na classificacao. */
async function tituloVivo(
  tx: PayableTransaction,
  ctx: ExecutionContext,
  id: string,
): Promise<PayableOutput> {
  const titulo = await tx.findById(ctx.companyId, id)
  if (titulo === null) throw AppError.notFound('Conta a pagar não encontrada.')
  if (titulo.status === 'cancelled') {
    throw AppError.conflict('Esta conta já foi cancelada.')
  }
  return titulo
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
  const titulo = await tituloVivo(tx, ctx, id)
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

  /* A conta do plano tem de ser desta loja: a chave estrangeira confere que
     ela existe, nao de quem e. */
  if (input.accountId != null && deps.accounts !== undefined) {
    const conta = await deps.accounts.findById(ctx.companyId, input.accountId)
    if (conta === undefined) throw AppError.validation('Plano de conta não encontrado.')
  }

  /* Trocar so o plano de conta nao mexe em dinheiro: vale com baixa. */
  const soClassificacao = Object.entries(input).every(
    ([campo, valor]) => campo === 'accountId' || valor === undefined,
  )

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const antes = soClassificacao ? await tituloVivo(tx, ctx, id) : await tituloMutavel(tx, ctx, id)
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
        accountId: antes.accountId,
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
