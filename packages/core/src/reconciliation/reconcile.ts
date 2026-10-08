import type {
  BankTransactionDirection,
  CreateEntryFromTransactionInput,
  EntryKind,
  ReconcileInput,
  UndoReconciliationInput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type {
  BankTransactionSnapshot,
  LancamentoConciliavel,
  ReconciliationTransaction,
} from '../ports/reconciliation-repository.js'
import type { ReconciliationDeps } from './suggest-matches.js'

/**
 * O que a conciliacao E, e o que ela NAO e.
 *
 * Ela liga uma linha do extrato a um lancamento: "este dinheiro que o banco
 * mostra e este titulo". Nada mais.
 *
 * Em particular ela **nao da baixa** no titulo, e a tentacao de fazer isso e
 * grande — o lojista ve o debito de R$ 480 da conta de luz e obviamente a conta
 * foi paga. Tres motivos para nao:
 *
 * 1. Baixa muda o quanto se deve e o saldo do cliente, com regras proprias
 *    (parcial, estorno por linha negativa) que sao RF-059, RF-060 e RF-067.
 *    Baixar por aqui criaria um segundo caminho para alterar divida, com metade
 *    das regras e sem passar pelos testes que as provam.
 * 2. Desfazer nao teria simetria. Desconciliar solta um vinculo; desbaixar
 *    exige lancar um estorno negativo (RF-067), que nao se apaga. Se conciliar
 *    baixasse, desfazer deixaria linhas de baixa e de estorno como cicatriz de
 *    uma operacao que o lojista pediu para anular.
 * 3. O titulo pode ja estar baixado por outro meio. O recebivel do cartao nasce
 *    liquidado (RF-064) e o repasse chega no extrato depois; conciliar tentaria
 *    baixar o que ja esta baixado.
 *
 * A tela oferece as duas acoes lado a lado. Elas sao duas.
 */

/** Casa transacao com lancamento existente — RF-079. */
export async function reconcile(
  deps: ReconciliationDeps,
  ctx: ExecutionContext,
  input: ReconcileInput,
): Promise<void> {
  assertCanWrite(ctx)

  await deps.uow.transaction(ctx.companyId, async (tx) => {
    const transacao = await tx.findTransaction(ctx.companyId, input.transactionId)
    if (transacao === undefined) throw AppError.notFound('Transação não encontrada.')

    if (transacao.reconciledEntryId !== null) {
      throw AppError.conflict('Esta transação já está conciliada. Desfaça antes de casar de novo.')
    }

    const lancamento = await tx.findEntry(ctx.companyId, input.entryKind, input.entryId)
    if (lancamento === undefined) throw AppError.notFound('Lançamento não encontrado.')

    conferePodeCasar(transacao, lancamento, input.entryKind)

    const casou = await tx.link(
      ctx.companyId,
      transacao.id,
      input.entryKind,
      lancamento.id,
      ctx.now,
    )

    /* A leitura acima disse que estava livre, e entre ela e o `link` outra aba
       pode ter conciliado a mesma transacao. Quem decide e a escrita. */
    if (!casou) {
      throw AppError.conflict('Esta transação acabou de ser conciliada. Recarregue a tela.')
    }

    await registra(tx, ctx, transacao, input.entryKind, lancamento.id, 'updated', {
      reconciledWith: lancamento.id,
      amountCents: transacao.amountCents,
    })
  })
}

/**
 * Cria o lancamento a partir da transacao e concilia — RF-079.
 *
 * O caso de "caiu no extrato e nao existe no sistema", que e comum: compra paga
 * na maquininha do fornecedor, tarifa do banco, transferencia que ninguem
 * lancou. Sem este caminho, o lojista teria de sair da conciliacao, lancar a
 * conta pela tela de contas adivinhando valor e data, e voltar — e a fila de
 * conciliacao existe para nao obrigar isso.
 *
 * Valor, data e direcao saem da TRANSACAO. E o que garante que o lancamento
 * criado corresponde a linha conciliada: nao ha como digitar um valor diferente
 * do que o banco mostra.
 */
export async function createEntryFromTransaction(
  deps: ReconciliationDeps,
  ctx: ExecutionContext,
  input: CreateEntryFromTransactionInput,
): Promise<{ readonly entryKind: EntryKind; readonly entryId: string }> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const transacao = await tx.findTransaction(ctx.companyId, input.transactionId)
    if (transacao === undefined) throw AppError.notFound('Transação não encontrada.')

    if (transacao.reconciledEntryId !== null) {
      throw AppError.conflict('Esta transação já está conciliada.')
    }

    const entryKind = tipoQueCasaCom(transacao.direction)

    const criado = await tx.insertEntry({
      companyId: ctx.companyId,
      entryKind,
      counterparty: input.counterparty,
      description: input.description,
      amountCents: transacao.amountCents,
      dueDate: transacao.postedOn,
      accountId: input.accountId ?? null,
      createdBy: ctx.userId,
      createdAt: ctx.now,
    })

    const casou = await tx.link(ctx.companyId, transacao.id, entryKind, criado.id, ctx.now)

    /* Mesma transacao do banco: se nao casou, o lancamento que acabamos de
       gravar tambem desaparece. E o motivo de as duas escritas estarem aqui
       dentro — lancamento orfao no meio das contas do lojista seria pior que a
       falha. */
    if (!casou) {
      throw AppError.conflict('Esta transação acabou de ser conciliada. Recarregue a tela.')
    }

    await registra(tx, ctx, transacao, entryKind, criado.id, 'created', {
      counterparty: input.counterparty,
      description: input.description,
      amountCents: transacao.amountCents,
      dueDate: transacao.postedOn,
      createdFromBankTransaction: transacao.id,
    })

    return { entryKind, entryId: criado.id }
  })
}

/**
 * Desfaz a conciliacao — RF-080.
 *
 * Os dois voltam para a fila: a transacao volta a pedir sugestao, e o
 * lancamento volta a ser candidato. E o unico jeito de corrigir um casamento
 * errado, e por isso exige motivo escrito — sem ele, a auditoria registraria
 * que alguem desfez e nao por que, que e a unica pergunta que se faz depois.
 *
 * O lancamento criado por `createEntryFromTransaction` NAO e apagado aqui.
 * Desfazer a conferencia e uma coisa; apagar uma conta a pagar e outra, tem
 * regra propria e pode ja ter baixa, classificacao e anexo pendurados.
 */
export async function undoReconciliation(
  deps: ReconciliationDeps,
  ctx: ExecutionContext,
  input: UndoReconciliationInput,
): Promise<void> {
  assertCanWrite(ctx)

  await deps.uow.transaction(ctx.companyId, async (tx) => {
    const transacao = await tx.findTransaction(ctx.companyId, input.transactionId)
    if (transacao === undefined) throw AppError.notFound('Transação não encontrada.')

    if (transacao.reconciledEntryId === null) {
      throw AppError.conflict('Esta transação não está conciliada.')
    }

    await tx.unlink(ctx.companyId, transacao.id)

    await registra(
      tx,
      ctx,
      transacao,
      transacao.reconciledEntryKind!,
      transacao.reconciledEntryId,
      'cancelled',
      { reason: input.reason, wasReconciledWith: transacao.reconciledEntryId },
    )
  })
}

/**
 * As duas recusas que impedem uma conferencia falsa.
 *
 * Valem tanto para a sugestao aceita quanto para o casamento escolhido a mao —
 * e e o caminho a mao que precisa delas, porque a sugestao ja nasce filtrada.
 * Uma tela nova, ou uma chamada de API direta, entra por aqui.
 */
function conferePodeCasar(
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

function tipoQueCasaCom(direction: BankTransactionDirection): EntryKind {
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
async function registra(
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
