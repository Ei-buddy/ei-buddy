import type { BankAccountOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

export type NewBankAccount = {
  readonly companyId: CompanyId
  readonly name: string
  readonly bank: string | null
  readonly agency: string | null
  readonly accountNumber: string | null
  readonly openingBalanceCents: number
  readonly openingDate: string
  readonly createdBy: UserId
  readonly createdAt: Date
}

/** Contas da loja — RF-073. O saldo sai calculado das baixas, no banco. */
export type BankAccountRepository = {
  list(companyId: CompanyId): Promise<readonly BankAccountOutput[]>
  findById(companyId: CompanyId, id: string): Promise<BankAccountOutput | undefined>
  /** `undefined` quando o nome ja existe na loja (indice unico). */
  insert(nova: NewBankAccount): Promise<BankAccountOutput | undefined>
  /**
   * Editar — NR-152. A baixa grava o NOME da conta, entao renomear atualiza as
   * baixas na mesma transacao. `'nome_em_uso'` quando outra conta ja tem o nome.
   */
  update(
    companyId: CompanyId,
    id: string,
    changes: Omit<NewBankAccount, 'companyId' | 'createdBy' | 'createdAt'>,
  ): Promise<BankAccountOutput | 'nome_em_uso'>
  remove(companyId: CompanyId, id: string): Promise<void>
}
