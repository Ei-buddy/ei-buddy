import type { ReverseSettlementInput, SettlementOutput } from '@na-regua/contracts'
import { estornarBaixa } from '@na-regua/domain'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { SettleDeps } from './settle.js'
import { mexeNoSaldoDoCliente } from './customer-balance.js'

/**
 * Estorna uma baixa — RF-060, RF-067.
 *
 * O estorno **nao apaga** a baixa: grava uma linha nova, com valor negativo,
 * apontando para a que desfaz. E o padrao que o schema ja impoe
 * (`settlements_estorno_e_negativo`), e a propriedade que ele preserva e util:
 * a soma das linhas continua sendo o saldo baixado, entao conferir o titulo e
 * somar, nunca reconstruir historia.
 *
 * Um unico caso de uso para os dois tipos de titulo. A baixa precisou de dois
 * porque a entrada e diferente — conta bancaria de um lado, forma de
 * recebimento do outro. Aqui a entrada e so "qual baixa", e duplicar daria duas
 * chances de as regras divergirem.
 */
export async function reverseSettlement(
  deps: SettleDeps,
  ctx: ExecutionContext,
  input: ReverseSettlementInput,
): Promise<SettlementOutput> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const baixa = await tx.findSettlement(ctx.companyId, input.settlementId)
    if (baixa === undefined) throw AppError.notFound('Baixa não encontrada.')

    /* Estornar um estorno seria re-aplicar a baixa por um caminho que ninguem
       revisou. Quem quer baixar de novo, baixa de novo. */
    if (baixa.reversesId !== null) {
      throw AppError.conflict('Esta linha já é um estorno. Para baixar de novo, lance uma baixa.')
    }

    /* Sem isto, duas chamadas seguidas devolveriam a divida duas vezes — e o
       titulo terminaria com saldo baixado negativo. */
    if (await tx.hasReversal(ctx.companyId, baixa.id)) {
      throw AppError.conflict('Esta baixa já foi estornada.')
    }

    const ehPagar = baixa.payableId !== null
    const tituloId = (ehPagar ? baixa.payableId : baixa.receivableId)!

    const titulo = ehPagar
      ? await tx.findPayable(ctx.companyId, tituloId)
      : await tx.findReceivable(ctx.companyId, tituloId)

    if (titulo === undefined) throw AppError.notFound('Título da baixa não encontrado.')

    const r = estornarBaixa(titulo.amountCents, titulo.settledAmountCents, baixa.amountCents)

    const linha = await tx.insertSettlement({
      companyId: ctx.companyId,
      payableId: baixa.payableId,
      receivableId: baixa.receivableId,
      /* Negativo: e o que mantem "somar as linhas = saldo baixado". */
      amountCents: -baixa.amountCents,
      method: baixa.method,
      bankAccount: baixa.bankAccount,
      settledOn: ctx.now.toISOString().slice(0, 10),
      notes: input.reason,
      reversesId: baixa.id,
      createdBy: ctx.userId,
      createdAt: ctx.now,
    })

    await tx.updateTitulo(
      ctx.companyId,
      ehPagar ? 'payable' : 'receivable',
      titulo.id,
      r.settledAmountCents,
      r.status,
    )

    /* Ele voltou a dever. Positivo — e exatamente o oposto do que a baixa fez,
       decidido pela MESMA funcao, para os dois nao divergirem. */
    if (!ehPagar && mexeNoSaldoDoCliente(titulo)) {
      await tx.adjustCustomerBalance(ctx.companyId, titulo.customerId!, baixa.amountCents)
    }

    await tx.record({
      companyId: ctx.companyId,
      entity: ehPagar ? 'Payable' : 'Receivable',
      entityId: titulo.id,
      action: 'cancelled',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: { settledAmountCents: titulo.settledAmountCents, status: titulo.status },
      after: { settledAmountCents: r.settledAmountCents, status: r.status, reason: input.reason },
    })

    return linha
  })
}
