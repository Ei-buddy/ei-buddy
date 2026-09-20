import type {
  SettlementOutput,
  SettlePayableInput,
  SettleReceivableInput,
} from '@na-regua/contracts'
import { aplicarBaixa } from '@na-regua/domain'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import { usuarioReal } from '../system-actor.js'
import type { SettlementUnitOfWork } from '../ports/settlement-writers.js'
import { mexeNoSaldoDoCliente } from './customer-balance.js'

export type SettleDeps = {
  readonly uow: SettlementUnitOfWork
  /*
   * Sem `audit` aqui desde a NR-087.
   *
   * A auditoria deste caso de uso acontece DENTRO da transacao, por
   * `tx.record` — ver `TransactionalAuditTrail`. Manter a trilha nas
   * dependencias faria todo construtor montar uma que ninguem usa, e o proximo
   * leitor suporia que o caso de uso audita por ali.
   */
}

/**
 * Baixa em conta a pagar, total ou parcial — RF-059.
 *
 * Conta a pagar nao mexe em saldo de cliente: quem recebe e o fornecedor, e a
 * loja nao guarda o quanto deve a ele como saldo — cada conta e um titulo.
 */
export async function settlePayable(
  deps: SettleDeps,
  ctx: ExecutionContext,
  input: SettlePayableInput,
): Promise<SettlementOutput> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const titulo = await tx.findPayable(ctx.companyId, input.payableId)
    if (titulo === undefined) throw AppError.notFound('Conta nao encontrada.')
    if (titulo.status === 'cancelled') {
      throw AppError.conflict('Esta conta foi cancelada e nao pode receber baixa.')
    }

    /* A aritmetica e de `domain`, e a mesma para os dois tipos de titulo. */
    const r = aplicarBaixa(titulo.amountCents, titulo.settledAmountCents, input.amountCents)

    const baixa = await tx.insertSettlement({
      companyId: ctx.companyId,
      payableId: titulo.id,
      receivableId: null,
      amountCents: input.amountCents,
      method: null,
      bankAccount: input.bankAccount,
      settledOn: input.settledOn,
      notes: input.notes ?? null,
      reversesId: null,
      /* `null` quando foi o sistema: a coluna referencia `users`, e o
         sistema nao e um usuario — ver `system-actor.ts`. */
      createdBy: usuarioReal(ctx),
      createdAt: ctx.now,
    })

    await tx.updateTitulo(ctx.companyId, 'payable', titulo.id, r.settledAmountCents, r.status)

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Payable',
      entityId: titulo.id,
      action: 'updated',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: { settledAmountCents: titulo.settledAmountCents, status: titulo.status },
      after: { settledAmountCents: r.settledAmountCents, status: r.status },
    })

    return baixa
  })
}

/**
 * Baixa em recebivel, total ou parcial — RF-066.
 *
 * "O saldo do cliente diminui" (US-032) — mas so quando a divida e dele. Ver
 * `mexeNoSaldoDoCliente`.
 */
export async function settleReceivable(
  deps: SettleDeps,
  ctx: ExecutionContext,
  input: SettleReceivableInput,
): Promise<SettlementOutput> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const titulo = await tx.findReceivable(ctx.companyId, input.receivableId)
    if (titulo === undefined) throw AppError.notFound('Recebivel nao encontrado.')
    if (titulo.status === 'cancelled') {
      throw AppError.conflict('Este recebivel foi cancelado e nao pode receber baixa.')
    }

    const r = aplicarBaixa(titulo.amountCents, titulo.settledAmountCents, input.amountCents)

    const baixa = await tx.insertSettlement({
      companyId: ctx.companyId,
      payableId: null,
      receivableId: titulo.id,
      amountCents: input.amountCents,
      method: input.method,
      bankAccount: null,
      settledOn: input.settledOn,
      notes: input.notes ?? null,
      reversesId: null,
      /* `null` quando foi o sistema: a coluna referencia `users`, e o
         sistema nao e um usuario — ver `system-actor.ts`. */
      createdBy: usuarioReal(ctx),
      createdAt: ctx.now,
    })

    await tx.updateTitulo(ctx.companyId, 'receivable', titulo.id, r.settledAmountCents, r.status)

    /* Ele pagou: deve menos. Negativo. */
    if (mexeNoSaldoDoCliente(titulo)) {
      await tx.adjustCustomerBalance(ctx.companyId, titulo.customerId!, -input.amountCents)
    }

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Receivable',
      entityId: titulo.id,
      action: 'updated',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: { settledAmountCents: titulo.settledAmountCents, status: titulo.status },
      after: { settledAmountCents: r.settledAmountCents, status: r.status },
    })

    return baixa
  })
}
