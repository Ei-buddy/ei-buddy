import type { AccountOutput, ClassifyEntryInput, SuggestAccountInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { ChartDeps } from './manage-accounts.js'

/** Classifica um lancamento numa conta — RF-083. */
export async function classifyEntry(
  deps: ChartDeps,
  ctx: ExecutionContext,
  input: ClassifyEntryInput,
): Promise<void> {
  assertCanWrite(ctx)

  const conta = await deps.accounts.findById(ctx.companyId, input.accountId)
  if (conta === undefined) throw AppError.notFound('Conta não encontrada.')

  await deps.accounts.classify(ctx.companyId, input.entryKind, input.entryId, input.accountId)

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: input.entryKind === 'payable' ? 'Payable' : 'Receivable',
    entityId: input.entryId,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { accountId: conta.id, accountName: conta.name },
  })
}

export type Sugestao = {
  readonly account: AccountOutput
  /** Quantas vezes esta contraparte ja caiu nesta conta. */
  readonly times: number
  /** Fracao das vezes, em pontos: 80 = em 80% das vezes foi esta conta. */
  readonly confidencePoints: number
}

/**
 * Sugere a conta a partir do historico da mesma contraparte — RF-084.
 *
 * O ganho e mecanico: a conta de luz chega todo mes, do mesmo fornecedor, e vai
 * sempre para "Energia, agua e internet". Fazer o lojista escolher doze vezes
 * por ano a mesma coisa e como ele para de classificar.
 *
 * **Sugere, nao classifica.** Aplicar sozinha economizaria um toque e criaria
 * um problema pior: uma classificacao errada que ninguem revisou se espalha
 * pelo historico e passa a sugerir a si mesma. O erro fica mais confiante a
 * cada mes.
 *
 * Devolve `undefined` quando nao ha historico — e diferente de sugerir a
 * primeira conta da lista, que seria um palpite com cara de recomendacao.
 */
export async function suggestAccount(
  deps: ChartDeps,
  ctx: ExecutionContext,
  input: SuggestAccountInput,
): Promise<Sugestao | undefined> {
  /* Leitura: `accountant` sugere como qualquer um. */
  const historico = await deps.accounts.historyFor(
    ctx.companyId,
    input.entryKind,
    input.counterparty,
  )

  const melhor = historico[0]
  if (melhor === undefined || melhor.times === 0) return undefined

  const conta = await deps.accounts.findById(ctx.companyId, melhor.accountId)
  /* A conta pode ter sido apagada depois de classificar — sugerir uma conta
     que nao existe mais daria erro na hora de aplicar. */
  if (conta === undefined) return undefined

  const total = historico.reduce((s, h) => s + h.times, 0)

  return {
    account: conta,
    times: melhor.times,
    /* Pontos, como o resto do sistema. Arredondado para inteiro: a diferenca
       entre 83% e 84% de confianca nao muda decisao nenhuma. */
    confidencePoints: Math.round((melhor.times / total) * 100),
  }
}
