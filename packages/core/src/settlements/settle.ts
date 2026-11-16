import {
  CONTA_DINHEIRO_DO_CAIXA,
  type PaymentMethod,
  type SettlementOutput,
  type SettlePayableInput,
  type SettleReceivableInput,
} from '@na-regua/contracts'
import { aplicarBaixa, DomainError } from '@na-regua/domain'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import { usuarioReal } from '../system-actor.js'
import type { SettlementTransaction, SettlementUnitOfWork } from '../ports/settlement-writers.js'
import type { BankAccountRepository } from '../ports/bank-account-repository.js'
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
  /**
   * As contas bancarias da loja, para recusar baixa em conta que nao existe.
   * Opcional so para os testes que nao falam de conta; a api sempre liga.
   */
  readonly bankAccounts?: Pick<BankAccountRepository, 'list'>
}

/**
 * A conta da baixa tem de existir — achado do QA: "permitiu baixar uma conta
 * em um banco inexistente". O saldo da conta bancaria e montado pelas baixas
 * com o NOME dela; uma baixa num nome que nao e conta nenhuma some de todos os
 * saldos e nunca concilia.
 *
 * Compara sem caixa e sem espaco nas pontas, como o saldo compara. Devolve o
 * nome como esta cadastrado, para a baixa gravar a grafia da conta.
 */
export async function contaCadastrada(
  bankAccounts: Pick<BankAccountRepository, 'list'> | undefined,
  ctx: ExecutionContext,
  nome: string,
): Promise<string> {
  const procurado = nome.trim().toLocaleLowerCase('pt-BR')
  if (procurado === CONTA_DINHEIRO_DO_CAIXA.toLocaleLowerCase('pt-BR')) {
    return CONTA_DINHEIRO_DO_CAIXA
  }
  if (bankAccounts === undefined) return nome

  const contas = await bankAccounts.list(ctx.companyId)
  const achada = contas.find((c) => c.name.trim().toLocaleLowerCase('pt-BR') === procurado)
  if (achada !== undefined) return achada.name

  throw AppError.validation(
    contas.length === 0
      ? `Nenhuma conta bancária cadastrada. Cadastre a conta em Financeiro > Contas bancárias, ou escolha "${CONTA_DINHEIRO_DO_CAIXA}".`
      : `A conta "${nome.trim()}" não está cadastrada. Escolha uma das contas da loja ou "${CONTA_DINHEIRO_DO_CAIXA}".`,
  )
}

/** O que uma baixa precisa saber, para os dois tipos de titulo. */
export type BaixaNaTransacao = {
  readonly kind: 'payable' | 'receivable'
  readonly tituloId: string
  readonly amountCents: number
  readonly method: PaymentMethod | null
  /** Ja conferida com `contaCadastrada` — nome como esta cadastrado. */
  readonly bankAccount: string | null
  readonly settledOn: string
  readonly notes: string | null
}

/**
 * A baixa DENTRO de uma transacao aberta por quem chama.
 *
 * E o unico caminho que grava baixa: a tela de contas (RF-059, RF-066) e a
 * conciliacao (DEC-026) passam por aqui. Dois caminhos teriam duas versoes
 * das regras — titulo cancelado, valor acima do saldo, saldo do cliente — e a
 * segunda seria a que ninguem testou.
 */
export async function lancarBaixa(
  tx: SettlementTransaction,
  ctx: ExecutionContext,
  b: BaixaNaTransacao,
): Promise<SettlementOutput> {
  const ehPagar = b.kind === 'payable'
  const titulo = ehPagar
    ? await tx.findPayable(ctx.companyId, b.tituloId)
    : await tx.findReceivable(ctx.companyId, b.tituloId)
  if (titulo === undefined) {
    throw AppError.notFound(ehPagar ? 'Conta não encontrada.' : 'Recebível não encontrado.')
  }
  if (titulo.status === 'cancelled') {
    throw AppError.conflict(
      ehPagar
        ? 'Esta conta foi cancelada e não pode receber baixa.'
        : 'Este recebível foi cancelado e não pode receber baixa.',
    )
  }

  /* A aritmetica e de `domain`, e a mesma para os dois tipos de titulo. */
  const r = baixaDeDominio(titulo.amountCents, titulo.settledAmountCents, b.amountCents)

  const baixa = await tx.insertSettlement({
    companyId: ctx.companyId,
    payableId: ehPagar ? titulo.id : null,
    receivableId: ehPagar ? null : titulo.id,
    amountCents: b.amountCents,
    method: b.method,
    bankAccount: b.bankAccount,
    settledOn: b.settledOn,
    notes: b.notes,
    reversesId: null,
    /* `null` quando foi o sistema: a coluna referencia `users`, e o
       sistema nao e um usuario — ver `system-actor.ts`. */
    createdBy: usuarioReal(ctx),
    createdAt: ctx.now,
  })

  await tx.updateTitulo(ctx.companyId, b.kind, titulo.id, r.settledAmountCents, r.status)

  /* Conta a pagar nao mexe em saldo de cliente. No recebivel, ele pagou: deve
     menos. Negativo. */
  if (!ehPagar && mexeNoSaldoDoCliente(titulo)) {
    await tx.adjustCustomerBalance(ctx.companyId, titulo.customerId!, -b.amountCents)
  }

  await tx.record({
    companyId: ctx.companyId,
    entity: ehPagar ? 'Payable' : 'Receivable',
    entityId: titulo.id,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { settledAmountCents: titulo.settledAmountCents, status: titulo.status },
    after: { settledAmountCents: r.settledAmountCents, status: r.status },
  })

  return baixa
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
  const conta = await contaCadastrada(deps.bankAccounts, ctx, input.bankAccount)

  return deps.uow.transaction(ctx.companyId, (tx) =>
    lancarBaixa(tx, ctx, {
      kind: 'payable',
      tituloId: input.payableId,
      amountCents: input.amountCents,
      method: null,
      bankAccount: conta,
      settledOn: input.settledOn,
      notes: input.notes ?? null,
    }),
  )
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
  const conta =
    input.bankAccount === undefined
      ? null
      : await contaCadastrada(deps.bankAccounts, ctx, input.bankAccount)

  return deps.uow.transaction(ctx.companyId, (tx) =>
    lancarBaixa(tx, ctx, {
      kind: 'receivable',
      tituloId: input.receivableId,
      amountCents: input.amountCents,
      method: input.method,
      bankAccount: conta,
      settledOn: input.settledOn,
      notes: input.notes ?? null,
    }),
  )
}

/**
 * A regra da baixa e de `domain`; o que ela recusa e erro do USUARIO.
 *
 * Sem esta traducao, "baixa maior que o saldo" e "titulo ja quitado" subiam
 * como DomainError cru, e o handler respondia 500 — "algo deu errado do nosso
 * lado" para um valor digitado a mais. Mesmo tratamento da venda.
 */
function baixaDeDominio(...args: Parameters<typeof aplicarBaixa>): ReturnType<typeof aplicarBaixa> {
  try {
    return aplicarBaixa(...args)
  } catch (erro) {
    if (erro instanceof DomainError) {
      if (erro.code === 'ALREADY_SETTLED') throw AppError.conflict(erro.message)
      throw AppError.validation(erro.message, [{ path: 'amountCents', message: erro.message }])
    }
    throw erro
  }
}
