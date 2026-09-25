import type { ReceivableOutput, ReceivableStatus } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'
import type { TransactionalAuditTrail } from './audit-trail.js'

/**
 * Portas dos recebiveis — RF-064 a RF-066.
 *
 * `ReceivableQueries` e so LEITURA. Quem cria recebivel de VENDA e o
 * `UnitOfWork` de `sale-writers`, e quem baixa e o `SettlementUnitOfWork` — os
 * dois escrevem em mais de uma tabela na mesma transacao, e essa
 * responsabilidade ja tem dono.
 *
 * `ManualReceivableUnitOfWork` e OUTRA coisa: o recebivel AVULSO (RF-065), que
 * nao vem de venda nenhuma — nao ha saldo de venda para duas portas
 * discordarem sobre. `NewManualReceivable` tem nome proprio, e nao
 * `NewReceivable`: esse nome ja e de `sale-writers`, para a linha que a venda
 * grava, com parcela e forma — confundir os dois faria alguem montar o avulso
 * com campo de venda.
 *
 * `companyId` em toda assinatura por decisao: o isolamento nao pode depender de
 * quem chama lembrar de filtrar.
 */
export type ReceivableQueries = {
  /**
   * Recebiveis da loja, filtrados por situacao.
   *
   * O filtro e do SQL e nao do chamador: a lista de "o que tenho a receber"
   * ignora o que ja foi recebido, e trazer tudo para descartar depois cresce
   * com o historico da loja — que e justamente o que nao para de crescer.
   */
  list(
    companyId: CompanyId,
    criterio: {
      readonly status: readonly ReceivableStatus[]
      /** So os deste cliente — a ficha do cliente (RF-072). */
      readonly customerId?: string
    },
  ): Promise<readonly ReceivableOutput[]>
}

export type NewManualReceivable = {
  readonly companyId: CompanyId
  readonly description: string
  /** Bruto e liquido sao o MESMO valor: recebivel avulso nao passa por
      adquirente, entao nao ha tarifa a descontar — RF-063 e so para venda. */
  readonly amountCents: number
  /** `AAAA-MM-DD`. Recebivel vence num dia, nao num instante. */
  readonly dueDate: string
  readonly customerId: string | null
  readonly accountId: string | null
  readonly createdBy: UserId
  readonly createdAt: Date
  /**
   * Esta divida e do CLIENTE — RF-013, migration 0037.
   *
   * Verdadeiro sempre que ha cliente: recebivel avulso nao tem forma de
   * pagamento, e quem lancou uma cobranca nominal esta dizendo que aquela
   * pessoa deve.
   */
  readonly isCustomerDebt: boolean
}

export type ManualReceivableTransaction = TransactionalAuditTrail & {
  insert(receivable: NewManualReceivable): Promise<ReceivableOutput>

  /**
   * Soma no que o cliente deve — RF-013.
   *
   * Cobranca nominal e divida de quem ela nomeia, e o comentario de
   * `mexeNoSaldoDoCliente` ja dizia isso — mas nada somava. So a BAIXA mexia no
   * saldo, para menos: lancar R$ 125 na ficha de alguem deixava o saldo em
   * zero, e baixar esses R$ 125 depois o levava a menos 125.
   */
  adjustCustomerBalance(customerId: string, deltaCents: number): Promise<void>
}

export type ManualReceivableUnitOfWork = {
  transaction<T>(
    companyId: CompanyId,
    fn: (tx: ManualReceivableTransaction) => Promise<T>,
  ): Promise<T>
}
