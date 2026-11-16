import type { BankTransactionDirection, EntryKind } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type {
  BankTransactionSnapshot,
  ConciliacaoComBaixaUnitOfWork,
  LancamentoConciliavel,
  ReconciliationTransaction,
} from '../ports/reconciliation-repository.js'
import type { ReconciliationDeps } from './suggest-matches.js'

/**
 * As regras que o par a par (`reconcile.ts`) e o lote (`confirm.ts`) usam —
 * num modulo so, e nao um importando o outro: as duas recusas e o rastro tem
 * de ser OS MESMOS nos dois caminhos.
 */

export function exigeBaixas(deps: ReconciliationDeps): ConciliacaoComBaixaUnitOfWork {
  if (deps.baixas === undefined) {
    /* Erro de montagem, e nao do usuario: a api sempre liga as baixas. */
    throw new Error('Conciliacao sem a unidade de trabalho da baixa (DEC-026).')
  }
  return deps.baixas
}

/**
 * As duas recusas que impedem uma conferencia falsa.
 *
 * Valem tanto para a sugestao aceita quanto para o casamento escolhido a mao —
 * e e o caminho a mao que precisa delas, porque a sugestao ja nasce filtrada.
 * Uma tela nova, ou uma chamada de API direta, entra por aqui.
 */
export function conferePodeCasar(
  transacao: BankTransactionSnapshot,
  lancamento: LancamentoConciliavel,
  entryKind: EntryKind,
): void {
  if (tipoQueCasaCom(transacao.direction) !== entryKind) {
    throw AppError.validation(
      transacao.direction === 'debit'
        ? 'Uma saída do banco só casa com conta a pagar.'
        : 'Uma entrada no banco só casa com título a receber.',
    )
  }

  if (lancamento.reconciled) {
    throw AppError.conflict('Este lançamento já está conciliado com outra transação.')
  }

  if (lancamento.status === 'cancelled') {
    throw AppError.conflict('Este lançamento está cancelado e não corresponde a nada no banco.')
  }

  const esperado = lancamento.netAmountCents ?? lancamento.amountCents
  if (esperado !== transacao.amountCents) {
    /* Diferenca de valor e informacao, nao ruido — ver JANELA_DE_DIAS. A
       mensagem diz os dois numeros porque o lojista precisa saber o TAMANHO da
       diferenca para descobrir o que ela e: R$ 2,50 e taxa, R$ 200 e outra
       conta. */
    throw AppError.validation(
      `O banco mostra ${reais(transacao.amountCents)} e o lançamento é de ${reais(esperado)}. ` +
        'Confira se é o título certo, ou lance a diferença antes de conciliar.',
    )
  }
}

export function tipoQueCasaCom(direction: BankTransactionDirection): EntryKind {
  return direction === 'debit' ? 'payable' : 'receivable'
}

/** Centavos como o lojista le. So para mensagem — nao volta para calculo. */
function reais(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`
}

/**
 * Rastro no historico do LANCAMENTO, e nao da transacao.
 *
 * A transacao do extrato nao e entidade que o lojista audita: ele pergunta "o
 * que aconteceu com esta conta a pagar", e a resposta tem de incluir "foi
 * conciliada com o extrato do dia 12". Auditar sob uma entidade
 * `BankTransaction` responderia a pergunta que ninguem faz.
 */
export async function registra(
  /*
   * Recebe o ESCOPO da transacao, e nao as dependencias — NR-087.
   *
   * Era `deps`, e a trilha era gravada fora da transacao que ela registra: uma
   * conciliacao desfeita no commit deixava na trilha uma conciliacao que nunca
   * houve. Ver `TransactionalAuditTrail`.
   */
  tx: ReconciliationTransaction,
  ctx: ExecutionContext,
  transacao: BankTransactionSnapshot,
  entryKind: EntryKind,
  entryId: string,
  action: 'created' | 'updated' | 'cancelled',
  after: Record<string, unknown>,
): Promise<void> {
  await tx.record({
    companyId: ctx.companyId,
    entity: entryKind === 'payable' ? 'Payable' : 'Receivable',
    entityId: entryId,
    action,
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { bankTransactionId: transacao.id, postedOn: transacao.postedOn, ...after },
  })
}
