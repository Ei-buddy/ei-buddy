import type { CancelSaleInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { SaleCancellationUnitOfWork } from '../ports/sale-cancellation.js'

export type CancelSaleDeps = {
  readonly uow: SaleCancellationUnitOfWork
}

/** RF-050 primeiro: a nota sai do ar antes do estoque voltar. */
const MSG_COM_NOTA =
  'Esta venda tem nota emitida. Cancele a nota no aplicativo primeiro — enquanto ela valer na SEFAZ, ' +
  'estornar o estoque aqui deixaria os dois lados divergentes. Nada foi alterado.'

const MSG_JA_BAIXADO =
  'Esta venda ja tem recebimento baixado. Estorne a baixa antes de cancelar: dinheiro que entrou no ' +
  'caixa nao pode sumir por um cancelamento em cascata. Nada foi alterado.'

/**
 * Cancela uma venda inteira, devolvendo o que ela tirou — RF-043, US-021.
 *
 * Cancela, nunca apaga (RNF-040): a venda continua no historico com o motivo,
 * quem cancelou e quando. Apagar resolveria a tela e destruiria a resposta de
 * "por que o caixa de terca nao fecha".
 *
 * ## O que ele RECUSA, e por que recusar e a resposta certa
 *
 * - **Venda com nota emitida.** O cancelamento precisa passar pela Focus
 *   (RF-050) ANTES do estorno, e esse caminho ainda nao existe. Estornar assim
 *   mesmo deixaria a nota valida na SEFAZ e a mercadoria de volta na loja — a
 *   divergencia que o fisco encontra depois.
 * - **Venda com recebimento ja baixado.** Desfazer em cascata mexeria em
 *   movimentacao de caixa possivelmente ja conciliada. Quem quer desfazer
 *   estorna a baixa antes, de propria conta e com trilha propria.
 * - **Venda ja cancelada ou devolvida.** Segunda passagem devolveria estoque
 *   duas vezes.
 *
 * Devolucao PARCIAL (RF-044) nao esta aqui: ela precisa dizer quais itens
 * voltam e estornar valor proporcional, e entra reaproveitando esta mesma
 * porta.
 */
export async function cancelSale(
  deps: CancelSaleDeps,
  ctx: ExecutionContext,
  input: CancelSaleInput,
): Promise<void> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const venda = await tx.findSale(input.saleId)

    /* Venda de outra empresa cai aqui como inexistente, e responde 404 — nunca
       403, que confirmaria que o id existe em algum lugar. */
    if (venda === undefined) {
      throw AppError.notFound('Venda nao encontrada.')
    }

    if (venda.status === 'cancelled' || venda.status === 'returned') {
      throw AppError.conflict('Esta venda ja foi cancelada ou devolvida. Nada foi alterado.')
    }

    if (venda.hasIssuedInvoice) {
      throw AppError.conflict(MSG_COM_NOTA)
    }

    if (venda.settledCents > 0) {
      throw AppError.conflict(MSG_JA_BAIXADO)
    }

    /*
     * A ordem importa pouco para o banco — e tudo uma transacao —, mas importa
     * para quem le: primeiro se desfaz o efeito no mundo (estoque, divida,
     * carteira), depois se marca a venda. Marcar antes e depois estornar daria
     * uma janela, na leitura do codigo, em que a venda esta cancelada e o
     * estoque ainda nao voltou.
     */
    await tx.restoreStock(venda.items, {
      saleId: venda.id,
      createdBy: ctx.userId,
      createdAt: ctx.now,
    })

    await tx.cancelReceivables(venda.id)

    if (venda.walletCents > 0 && venda.customerId !== null) {
      await tx.decreaseWalletBalance(venda.customerId, venda.walletCents)
    }

    await tx.markCancelled(venda.id, {
      reason: input.reason,
      by: ctx.userId,
      at: ctx.now,
    })

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Sale',
      entityId: venda.id,
      action: 'cancelled',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: { status: venda.status },
      /* O motivo entra na trilha, e nao so na venda: e a trilha que alguem le
         quando pergunta o que aconteceu naquele dia. */
      after: { status: 'cancelled', reason: input.reason },
    })
  })
}
