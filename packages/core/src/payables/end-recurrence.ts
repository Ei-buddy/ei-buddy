import type { EndRecurrenceInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { PayableUnitOfWork } from '../ports/payable-repository.js'

export type EndRecurrenceDeps = {
  readonly uow: PayableUnitOfWork
  /*
   * Sem `audit` aqui desde a NR-087.
   *
   * A auditoria deste caso de uso acontece DENTRO da transacao, por
   * `tx.record` — ver `TransactionalAuditTrail`. Manter a trilha nas
   * dependencias faria todo construtor montar uma que ninguem usa, e o proximo
   * leitor suporia que o caso de uso audita por ali.
   */
}

export type EndRecurrenceResult = {
  readonly recurrenceId: string
  /** Quantas ocorrencias futuras foram canceladas. */
  readonly cancelled: number
  /** Quantas ficaram — pagas ou ja vencidas. */
  readonly kept: number
}

/**
 * Encerra a recorrencia preservando o passado — RF-058.
 *
 * "Encerrar" NAO e apagar a serie. O que ja foi pago e historico do caixa, e o
 * que ja venceu e divida que existe mesmo que o lojista nao queira mais repetir
 * a conta. Some so o que ainda nao aconteceu.
 *
 * O corte e **hoje, inclusive**: a conta que vence hoje continua devida — o
 * lojista tem o dia inteiro para paga-la, e cancela-la ao encerrar a serie
 * faria uma divida real desaparecer da tela.
 */
export async function endRecurrence(
  deps: EndRecurrenceDeps,
  ctx: ExecutionContext,
  input: EndRecurrenceInput,
): Promise<EndRecurrenceResult> {
  assertCanWrite(ctx)

  const hoje = ctx.now.toISOString().slice(0, 10)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const daSerie = await tx.findByRecurrence(ctx.companyId, input.recurrenceId)

    /* Recorrencia de outra empresa cai aqui como inexistente — a lista volta
       vazia porque o repositorio filtra por empresa, e o 404 sai igual. */
    if (daSerie.length === 0) {
      throw AppError.notFound('Recorrência não encontrada.')
    }

    const cancelled = await tx.cancelFutureOccurrences(
      ctx.companyId,
      input.recurrenceId,
      hoje,
      ctx.userId,
      ctx.now,
    )

    if (cancelled === 0) {
      /* Distinguir de "encerrei tres" importa: a serie ja acabou, e dizer
         "pronto" faria o lojista achar que evitou uma cobranca futura que na
         verdade ja tinha acontecido. */
      throw AppError.conflict('Esta recorrência não tem ocorrências futuras para encerrar.')
    }

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Payable',
      entityId: input.recurrenceId,
      action: 'cancelled',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: { occurrences: daSerie.length },
      after: { cancelled, keptFrom: hoje },
    })

    return {
      recurrenceId: input.recurrenceId,
      cancelled,
      kept: daSerie.length - cancelled,
    }
  })
}
