import type {
  BankAccountOutput,
  CreateBankAccountInput,
  UpdateBankAccountInput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { BankAccountRepository } from '../ports/bank-account-repository.js'

export type BankAccountDeps = {
  readonly bankAccounts: BankAccountRepository
  readonly audit: AuditTrail
}

/** As contas da loja, com o saldo de cada uma — RF-073. */
export async function listBankAccounts(
  deps: BankAccountDeps,
  ctx: ExecutionContext,
): Promise<readonly BankAccountOutput[]> {
  return deps.bankAccounts.list(ctx.companyId)
}

/**
 * Cadastra a conta com o saldo inicial — RF-073, US-035.
 *
 * O nome e unico na loja: e por ele que a baixa diz onde o dinheiro entrou
 * (`settlements.bank_account`), e dois "Caixa" fariam o saldo de um somar as
 * baixas do outro.
 */
export async function createBankAccount(
  deps: BankAccountDeps,
  ctx: ExecutionContext,
  input: CreateBankAccountInput,
): Promise<BankAccountOutput> {
  assertCanWrite(ctx)

  const conta = await deps.bankAccounts.insert({
    companyId: ctx.companyId,
    name: input.name,
    bank: input.bank ?? null,
    agency: input.agency ?? null,
    accountNumber: input.accountNumber ?? null,
    openingBalanceCents: input.openingBalanceCents,
    openingDate: input.openingDate,
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })
  if (conta === undefined) {
    throw AppError.conflict('Já existe uma conta com este nome.')
  }

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'BankAccount',
    entityId: conta.id,
    action: 'created',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { name: conta.name, openingBalanceCents: conta.openingBalanceCents },
  })

  return conta
}

/**
 * Tira a conta do cadastro. As baixas que ja citam o nome continuam como
 * estao: elas registram onde o dinheiro entrou naquele dia, e isso nao muda.
 */
export async function deleteBankAccount(
  deps: BankAccountDeps,
  ctx: ExecutionContext,
  id: string,
): Promise<void> {
  assertCanWrite(ctx)

  const conta = await deps.bankAccounts.findById(ctx.companyId, id)
  if (conta === undefined) throw AppError.notFound('Conta não encontrada.')

  await deps.bankAccounts.remove(ctx.companyId, id)

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'BankAccount',
    entityId: conta.id,
    action: 'deleted',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { name: conta.name },
    after: null,
  })
}

/**
 * Editar a conta — NR-152.
 *
 * Renomear e seguro: o repositorio leva o nome novo para as baixas ja
 * registradas, na mesma transacao, e o saldo continua o mesmo. Mudar o saldo
 * inicial ou a data de abertura muda o saldo atual — e e para isso que serve.
 */
export async function updateBankAccount(
  deps: BankAccountDeps,
  ctx: ExecutionContext,
  id: string,
  input: UpdateBankAccountInput,
): Promise<BankAccountOutput> {
  assertCanWrite(ctx)

  const antes = await deps.bankAccounts.findById(ctx.companyId, id)
  if (antes === undefined) throw AppError.notFound('Conta não encontrada.')

  const depois = await deps.bankAccounts.update(ctx.companyId, id, {
    name: input.name,
    bank: input.bank ?? null,
    agency: input.agency ?? null,
    accountNumber: input.accountNumber ?? null,
    openingBalanceCents: input.openingBalanceCents,
    openingDate: input.openingDate,
  })
  if (depois === 'nome_em_uso') throw AppError.conflict('Já existe uma conta com este nome.')

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'BankAccount',
    entityId: id,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: {
      name: antes.name,
      openingBalanceCents: antes.openingBalanceCents,
      openingDate: antes.openingDate,
    },
    after: {
      name: depois.name,
      openingBalanceCents: depois.openingBalanceCents,
      openingDate: depois.openingDate,
    },
  })

  return depois
}
