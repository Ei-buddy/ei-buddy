import type { CreateReceivableInput, ReceivableOutput } from '@na-regua/contracts'
import { assertCanWrite } from '../authorization.js'
import { nasceComoDividaDoCliente } from '../settlements/customer-balance.js'
import type { ExecutionContext } from '../context.js'
import type { ManualReceivableUnitOfWork } from '../ports/receivable-repository.js'

export type CreateReceivableDeps = {
  readonly uow: ManualReceivableUnitOfWork
}

/**
 * Lanca recebivel avulso, que nao vem de venda — RF-065.
 *
 * So uma linha, sem recorrencia: a RF-065 nao pede parcelamento nem repeticao
 * para o avulso — quem precisa de varias parcelas lanca uma venda, que ja
 * resolve isso. `installmentNumber`/`installmentCount` saem fixos em 1/1, e
 * nao nulos, porque `ReceivableOutput` os declara como inteiros — o mesmo
 * campo que a venda usa para "3/12" aqui sempre diz "sem parcela".
 */
export async function createReceivable(
  deps: CreateReceivableDeps,
  ctx: ExecutionContext,
  input: CreateReceivableInput,
): Promise<ReceivableOutput> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const gravado = await tx.insert({
      companyId: ctx.companyId,
      description: input.description,
      amountCents: input.amountCents,
      dueDate: input.dueDate,
      customerId: input.customerId ?? null,
      accountId: input.accountId ?? null,
      isCustomerDebt: nasceComoDividaDoCliente(input.customerId ?? null, null),
      createdBy: ctx.userId,
      createdAt: ctx.now,
    })

    /*
     * A divida nasce e o saldo sobe, na MESMA transacao — RF-013.
     *
     * Ate aqui so a baixa mexia no saldo, e para menos: lancar uma cobranca
     * nominal de R$ 125 deixava o saldo em zero, e baixar esses R$ 125 depois
     * o levava a menos 125 — o cliente aparecia com credito na loja.
     */
    if (input.customerId !== undefined) {
      await tx.adjustCustomerBalance(input.customerId, input.amountCents)
    }

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Receivable',
      entityId: gravado.id,
      action: 'created',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: null,
      after: {
        description: input.description,
        amountCents: input.amountCents,
        dueDate: input.dueDate,
      },
    })

    return gravado
  })
}
