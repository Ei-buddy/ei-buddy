import type { CreatePayableInput, PayableOutput } from '@na-regua/contracts'
import { ocorrenciasDaRecorrencia } from '@na-regua/domain'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { IdGenerator, NewPayable, PayableUnitOfWork } from '../ports/payable-repository.js'

export type CreatePayableDeps = {
  readonly uow: PayableUnitOfWork
  readonly ids: IdGenerator
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
 * Lanca conta a pagar, avulsa ou recorrente — RF-055, RF-057.
 *
 * Recorrencia vira N linhas de verdade, e nao uma regra que a leitura expande.
 * As duas saidas existem, e a escolha e deliberada:
 *
 * - **Regra expandida na leitura** ocupa menos espaco e responde "quais as
 *   proximas" sem gravar nada. Mas RF-058 pede alterar UMA ocorrencia sem
 *   afetar as demais, e uma ocorrencia que nao existe como linha nao tem onde
 *   guardar a alteracao. A saida seria uma tabela de excecoes, que e a mesma
 *   coisa com mais passos.
 * - **Linhas materializadas** custam 120 registros no pior caso — nada, para o
 *   volume de uma loja — e cada uma e um titulo comum, que baixa, estorna e
 *   aparece na lista como qualquer outro.
 */
export async function createPayable(
  deps: CreatePayableDeps,
  ctx: ExecutionContext,
  input: CreatePayableInput,
): Promise<readonly PayableOutput[]> {
  assertCanWrite(ctx)

  const recorrente = input.recurrence !== undefined
  const recurrenceId = recorrente ? deps.ids.next() : null

  /* O `domain` cuida do calendario — inclusive de manter o dia 31 nos meses
     que o tem, em vez de deixar a conta migrar para o dia 28. */
  const vencimentos = recorrente
    ? ocorrenciasDaRecorrencia(
        input.dueDate,
        input.recurrence!.frequency,
        input.recurrence!.occurrences,
      )
    : [input.dueDate]

  const contas: NewPayable[] = vencimentos.map((dueDate, i) => ({
    companyId: ctx.companyId,
    supplier: input.supplier,
    description: input.description,
    amountCents: input.amountCents,
    dueDate,
    attachmentKey: input.attachmentKey ?? null,
    accountId: input.accountId ?? null,
    recurrenceId,
    occurrenceNumber: recorrente ? i + 1 : null,
    occurrenceCount: recorrente ? vencimentos.length : null,
    createdBy: ctx.userId,
    createdAt: ctx.now,
  }))

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    /* Todas de uma vez: metade de uma recorrencia gravada e pior que nenhuma —
       o lojista veria algo que existe pela metade sem saber ate quando vale. */
    const gravadas = await tx.insertMany(contas)

    if (gravadas.length === 0) {
      throw AppError.conflict('Nenhuma conta foi lançada.')
    }

    /* Uma entrada para o lancamento inteiro, e nao uma por ocorrencia: doze
       linhas identicas na trilha escondem as que importam. */
    await tx.record({
      companyId: ctx.companyId,
      entity: 'Payable',
      entityId: recurrenceId ?? gravadas[0]!.id,
      action: 'created',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: null,
      after: {
        supplier: input.supplier,
        amountCents: input.amountCents,
        dueDate: input.dueDate,
        occurrences: gravadas.length,
      },
    })

    return gravadas
  })
}
