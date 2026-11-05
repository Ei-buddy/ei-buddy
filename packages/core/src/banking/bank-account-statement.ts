import type { BankAccountStatementOutput, BankAccountStatementQuery } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type { BankAccountRepository } from '../ports/bank-account-repository.js'

export type BankAccountStatementDeps = {
  readonly bankAccounts: Pick<BankAccountRepository, 'findById' | 'statement'>
}

/**
 * O extrato da conta no periodo — achado do QA: "Bancos: ter um extrato das
 * movimentacoes".
 *
 * Leitura, sem `assertCanWrite`: o contador confere o extrato.
 *
 * O saldo corrido e daqui, e nao do banco: e a mesma conta do saldo da lista
 * (inicial + baixas desde `openingDate`), contada linha a linha. O periodo que
 * comeca antes da abertura da conta comeca na abertura — antes dela a conta
 * nao tinha saldo para contar.
 */
export async function getBankAccountStatement(
  deps: BankAccountStatementDeps,
  ctx: ExecutionContext,
  id: string,
  periodo: BankAccountStatementQuery,
): Promise<BankAccountStatementOutput> {
  const conta = await deps.bankAccounts.findById(ctx.companyId, id)
  if (conta === undefined) throw AppError.notFound('Conta bancária não encontrada.')

  const inicio = periodo.from < conta.openingDate ? conta.openingDate : periodo.from
  const { antesCents, movimentos } =
    periodo.to < conta.openingDate
      ? { antesCents: 0, movimentos: [] }
      : await deps.bankAccounts.statement(
          ctx.companyId,
          { name: conta.name, openingDate: conta.openingDate },
          inicio,
          periodo.to,
        )

  const abertura = conta.openingBalanceCents + antesCents
  let saldo = abertura
  let entrou = 0
  let saiu = 0
  const entries = movimentos.map((m) => {
    saldo += m.amountCents
    if (m.amountCents > 0) entrou += m.amountCents
    else saiu += -m.amountCents
    return { ...m, balanceCents: saldo }
  })

  return {
    account: conta,
    from: periodo.from,
    to: periodo.to,
    openingCents: abertura,
    inflowCents: entrou,
    outflowCents: saiu,
    closingCents: saldo,
    entries,
  }
}
