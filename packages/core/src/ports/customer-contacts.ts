import type { CustomerContactKind, CustomerContactOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/**
 * O diario de contatos com o cliente — RF-011, NR-072.
 *
 * Porta propria, e nao um metodo a mais em `CustomerRepository`: sao perguntas
 * diferentes. Aquele responde "quem e este cliente"; este responde "o que ja
 * conversamos com ele". Juntar faria toda leitura de ficha carregar a porta
 * inteira do historico.
 */
export type NewCustomerContact = {
  readonly companyId: CompanyId
  readonly customerId: string
  readonly kind: CustomerContactKind
  readonly description: string
  /** O dia do FATO, em AAAA-MM-DD. Nao e o dia do registro. */
  readonly happenedOn: string
  readonly createdBy: UserId
}

export type CustomerContactRepository = {
  /**
   * Grava o contato.
   *
   * `undefined` quando o cliente nao existe ou e de outra empresa — a RLS nao
   * ajuda aqui, porque a linha nova seria inserida com o `company_id` do
   * contexto ainda que o `customer_id` fosse de outra loja. Quem confere e o
   * adapter, antes de inserir.
   */
  create(contact: NewCustomerContact): Promise<CustomerContactOutput | undefined>

  /**
   * Os contatos de um cliente, do mais recente para o mais antigo.
   *
   * Sem paginacao: a ficha mostra a lista inteira, e um cliente com mais de
   * algumas dezenas de contatos e caso raro o bastante para nao pagar por um
   * cursor em toda abertura. O `limite` existe para o dia em que nao for.
   */
  listByCustomer(
    companyId: CompanyId,
    customerId: string,
    limite: number,
  ): Promise<readonly CustomerContactOutput[]>
}
