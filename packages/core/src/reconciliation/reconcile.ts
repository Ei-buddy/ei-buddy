import type {
  CreateEntryFromTransactionInput,
  EntryKind,
  ReconcileInput,
  UndoReconciliationInput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { ConciliacaoComBaixaTransaction } from '../ports/reconciliation-repository.js'
import { contaCadastrada, lancarBaixa } from '../settlements/settle.js'
import { estornarNaTransacao } from '../settlements/reverse-settlement.js'
import { confirmReconciliations } from './confirm.js'
import { conferePodeCasar, exigeBaixas, registra, tipoQueCasaCom } from './regras.js'
import type { ReconciliationDeps } from './suggest-matches.js'

/**
 * O que a conciliacao E.
 *
 * Ela liga uma linha do extrato a um lancamento: "este dinheiro que o banco
 * mostra e este titulo" — e, desde a DEC-026 (15/11), DA BAIXA no titulo,
 * na conta do extrato e na data do banco. Ver `confirm.ts`.
 *
 * Antes da DEC-026 ela nao baixava, pelos tres motivos abaixo. A decisao do
 * produto foi outra (conferir o extrato e dar baixa conta por conta era o
 * trabalho dobrado), e cada motivo virou uma regra do caminho novo:
 *
 * - 1: a baixa da conciliacao e a MESMA da tela de contas (`lancarBaixa`),
 *   com as mesmas recusas — nao ha segundo caminho;
 * - 2: desfazer a conciliacao ESTORNA a baixa que ela lancou, com o motivo
 *   escrito (RF-067) — a cicatriz e o rastro, e e desejado;
 * - 3: titulo ja quitado (o recebivel do cartao) so e ligado, sem baixa nova.
 *
 * O texto original, para quem quiser o raciocinio inteiro:
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

  /* Com a conta do extrato, concilia E da baixa — DEC-026. Um par so e o mesmo
     caminho do lote. */
  if (input.bankAccount !== undefined) {
    await confirmReconciliations(deps, ctx, {
      bankAccount: input.bankAccount,
      pairs: [
        { transactionId: input.transactionId, entryKind: input.entryKind, entryId: input.entryId },
      ],
    })
    return
  }

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

  /* Com a conta do extrato, o lancamento ja nasce baixado — DEC-026: o
     dinheiro ja entrou ou saiu, e o extrato e a prova. */
  const conta =
    input.bankAccount === undefined
      ? undefined
      : await contaCadastrada(deps.bankAccounts, ctx, input.bankAccount)
  const uow = conta === undefined ? deps.uow : exigeBaixas(deps)

  return uow.transaction(ctx.companyId, async (tx) => {
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

    if (conta !== undefined) {
      const comBaixa = tx as ConciliacaoComBaixaTransaction
      const baixa = await lancarBaixa(comBaixa, ctx, {
        kind: entryKind,
        tituloId: criado.id,
        amountCents: transacao.amountCents,
        method: null,
        bankAccount: conta,
        settledOn: transacao.postedOn,
        notes: `Conciliação do extrato: ${transacao.description}`.slice(0, 500),
      })
      await comBaixa.setSettlement(ctx.companyId, transacao.id, baixa.id)
    }

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

  /* Com as baixas ligadas (a api sempre), o desfazer estorna a baixa que a
     conciliacao lancou — DEC-026. Sem elas, so solta o vinculo, como antes. */
  if (deps.baixas !== undefined) {
    await deps.baixas.transaction(ctx.companyId, (tx) => desfazerComEstorno(tx, ctx, input))
    return
  }

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
 * Desfaz e estorna a baixa da conciliacao — DEC-026, RF-067.
 *
 * So a baixa que a CONCILIACAO lancou (`settlementId`). A baixa que a pessoa
 * lancou a mao na tela de contas continua: ela nao veio daqui. E se a baixa da
 * conciliacao ja foi estornada a mao, nao se estorna duas vezes.
 */
async function desfazerComEstorno(
  tx: ConciliacaoComBaixaTransaction,
  ctx: ExecutionContext,
  input: UndoReconciliationInput,
): Promise<void> {
  const transacao = await tx.findTransaction(ctx.companyId, input.transactionId)
  if (transacao === undefined) throw AppError.notFound('Transação não encontrada.')

  if (transacao.reconciledEntryId === null) {
    throw AppError.conflict('Esta transação não está conciliada.')
  }

  let estornada: string | null = null
  if (
    transacao.settlementId !== null &&
    !(await tx.hasReversal(ctx.companyId, transacao.settlementId))
  ) {
    const estorno = await estornarNaTransacao(
      tx,
      ctx,
      transacao.settlementId,
      `Conciliação desfeita: ${input.reason}`.slice(0, 500),
    )
    estornada = estorno.reversesId
  }

  /* Nesta ordem: o banco recusa baixa da conciliacao em linha nao conciliada
     (`bank_transactions_baixa_so_conciliada`). */
  await tx.setSettlement(ctx.companyId, transacao.id, null)
  await tx.unlink(ctx.companyId, transacao.id)

  await registra(
    tx,
    ctx,
    transacao,
    transacao.reconciledEntryKind!,
    transacao.reconciledEntryId,
    'cancelled',
    {
      reason: input.reason,
      wasReconciledWith: transacao.reconciledEntryId,
      reversedSettlementId: estornada,
    },
  )
}
