import type { AccountOutput, AccountType, EntryKind } from '@na-regua/contracts'
import type { ContaPadrao } from '../accounting/default-chart.js'
import type { CompanyId, UserId } from '../context.js'

/**
 * Portas do plano de contas e do DRE — NR-032, RF-081 a RF-086.
 */

export type NewAccount = {
  readonly companyId: CompanyId
  readonly name: string
  readonly type: AccountType
  readonly isDefault: boolean
  readonly createdBy: UserId
  readonly createdAt: Date
}

/**
 * Um lancamento do periodo, ja com a conta que ele recebeu.
 *
 * `sale` e a venda lida na data dela: nao tem conta, e `accountName` traz um
 * CODIGO (`vendas`, `impostos`, `cmv`...) que `core` traduz em rotulo.
 */
export type LancamentoClassificado = {
  readonly entryKind: EntryKind | 'sale'
  readonly entryId: string
  readonly accountId: string | null
  readonly accountName: string
  readonly accountType: AccountType
  readonly amountCents: number
  /** Data que define o periodo: competencia, nao caixa. */
  readonly occurredOn: string
}

export type ChartOfAccountsRepository = {
  list(companyId: CompanyId): Promise<readonly AccountOutput[]>
  findById(companyId: CompanyId, accountId: string): Promise<AccountOutput | undefined>
  /** Ja existe conta com este nome? O nome e unico por empresa. */
  findByName(companyId: CompanyId, name: string): Promise<AccountOutput | undefined>

  insert(conta: NewAccount): Promise<AccountOutput>
  rename(companyId: CompanyId, accountId: string, name: string): Promise<AccountOutput>
  remove(companyId: CompanyId, accountId: string): Promise<void>

  /**
   * Quantos lancamentos usam esta conta — RF-082.
   *
   * Contagem, e nao um booleano, porque a mensagem de recusa fica muito melhor
   * com o numero: "esta conta tem 42 lancamentos" diz ao lojista que ele vai
   * mexer em coisa seria; "esta conta esta em uso" nao diz nada.
   */
  countEntries(companyId: CompanyId, accountId: string): Promise<number>

  /** Grava a classificacao de um lancamento — RF-083. */
  classify(
    companyId: CompanyId,
    entryKind: EntryKind,
    entryId: string,
    accountId: string,
  ): Promise<void>

  /**
   * Contas que a mesma contraparte ja recebeu, da mais usada para a menos —
   * RF-084.
   *
   * Ordenar no repositorio, e nao em `core`, porque a ordenacao aqui e por
   * contagem sobre o historico inteiro: trazer tudo para contar na aplicacao
   * seria carregar anos de lancamento para escolher uma linha.
   */
  historyFor(
    companyId: CompanyId,
    entryKind: EntryKind,
    counterparty: string,
  ): Promise<readonly { accountId: string; accountName: string; times: number }[]>

  /**
   * Semeia o plano padrao ao concluir o onboarding — RF-081.
   *
   * Idempotente: grava ignorando nome que ja existe, e devolve quantas
   * entraram. A semeadura roda FORA da transacao que cria a empresa, e sem
   * isso uma segunda tentativa depois de falha parcial pararia no meio com
   * nome repetido — deixando o plano incompleto, que e pior que vazio porque
   * parece pronto.
   */
  insertDefaults(
    companyId: CompanyId,
    contas: readonly ContaPadrao[],
    createdBy: UserId,
    createdAt: Date,
  ): Promise<number>

  /** Lancamentos do periodo, por competencia — RF-085, RF-086. */
  entriesBetween(
    companyId: CompanyId,
    from: string,
    to: string,
  ): Promise<readonly LancamentoClassificado[]>
}
