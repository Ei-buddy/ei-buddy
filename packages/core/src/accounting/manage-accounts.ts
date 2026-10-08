import type {
  AccountOutput,
  CreateAccountInput,
  DeleteAccountInput,
  RenameAccountInput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { ChartOfAccountsRepository } from '../ports/chart-of-accounts.js'

export type ChartDeps = {
  readonly accounts: ChartOfAccountsRepository
  readonly audit: AuditTrail
}

/** Cria uma conta no plano — RF-082. */
export async function createAccount(
  deps: ChartDeps,
  ctx: ExecutionContext,
  input: CreateAccountInput,
): Promise<AccountOutput> {
  assertCanWrite(ctx)

  /* Nome unico por empresa. Duas contas "Aluguel" fazem o DRE mostrar duas
     linhas de aluguel, e o lojista conclui que pagou duas vezes. */
  const existente = await deps.accounts.findByName(ctx.companyId, input.name)
  if (existente !== undefined) {
    throw AppError.conflict(`Já existe uma conta chamada "${input.name}".`)
  }

  const conta = await deps.accounts.insert({
    companyId: ctx.companyId,
    name: input.name,
    type: input.type,
    /* Conta criada a mao nunca e do plano padrao — e o que a torna apagavel. */
    isDefault: false,
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Account',
    entityId: conta.id,
    action: 'created',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { name: conta.name, type: conta.type },
  })

  return conta
}

export async function renameAccount(
  deps: ChartDeps,
  ctx: ExecutionContext,
  input: RenameAccountInput,
): Promise<AccountOutput> {
  assertCanWrite(ctx)

  const atual = await deps.accounts.findById(ctx.companyId, input.accountId)
  if (atual === undefined) throw AppError.notFound('Conta não encontrada.')

  const colisao = await deps.accounts.findByName(ctx.companyId, input.name)
  if (colisao !== undefined && colisao.id !== atual.id) {
    throw AppError.conflict(`Já existe uma conta chamada "${input.name}".`)
  }

  /*
   * Renomear conta do plano padrao e PERMITIDO — o lojista chama "Energia,
   * agua e internet" do jeito dele. O que o padrao protege e a existencia da
   * conta, nao o nome dela: apagar quebra o DRE historico, renomear nao.
   */
  const conta = await deps.accounts.rename(ctx.companyId, input.accountId, input.name)

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Account',
    entityId: conta.id,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { name: atual.name },
    after: { name: conta.name },
  })

  return conta
}

/**
 * Apaga uma conta — RF-082, com as duas guardas que o requisito pede.
 *
 * "Impedindo exclusao de conta com lancamento" nao e detalhe de integridade: o
 * DRE de janeiro tem de continuar mostrando janeiro em marco. Apagar a conta
 * faria os lancamentos dela sumirem da linha e o resultado do mes fechado
 * MUDAR — um relatorio que muda depois de fechado nao serve para decidir nada.
 */
export async function deleteAccount(
  deps: ChartDeps,
  ctx: ExecutionContext,
  input: DeleteAccountInput,
): Promise<void> {
  assertCanWrite(ctx)

  const conta = await deps.accounts.findById(ctx.companyId, input.accountId)
  if (conta === undefined) throw AppError.notFound('Conta não encontrada.')

  if (conta.isDefault) {
    throw AppError.conflict(
      'Conta do plano padrão não pode ser apagada. Se não usa, deixe-a sem lançamento.',
    )
  }

  const lancamentos = await deps.accounts.countEntries(ctx.companyId, input.accountId)
  if (lancamentos > 0) {
    /* O numero na mensagem: "esta conta tem 42 lancamentos" diz que ele vai
       mexer em coisa seria; "esta conta esta em uso" nao diz nada. */
    throw AppError.conflict(
      `Esta conta tem ${lancamentos} lançamento(s) e não pode ser apagada. ` +
        'Reclassifique-os antes, ou renomeie a conta.',
    )
  }

  await deps.accounts.remove(ctx.companyId, input.accountId)

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Account',
    entityId: conta.id,
    action: 'deleted',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { name: conta.name, type: conta.type },
    after: null,
  })
}
