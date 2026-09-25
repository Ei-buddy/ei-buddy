import type { PaymentMethod, SettlementOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'
import type { TransactionalAuditTrail } from './audit-trail.js'

/**
 * Portas da baixa e do estorno — NR-029, RF-059, RF-060, RF-066, RF-067.
 *
 * A fronteira de transacao e o caso de uso, como sempre: gravar a baixa,
 * atualizar o titulo e mexer no saldo do cliente sao tres escritas que
 * precisam entrar juntas. Titulo quitado com o saldo do cliente intocado e a
 * divida que o sistema esqueceu de perdoar.
 */

/** O titulo como esta agora, para a regra decidir. */
export type TituloSnapshot = {
  readonly id: string
  readonly amountCents: number
  readonly settledAmountCents: number
  readonly status: string
  /** Nulo quando o titulo nao esta ligado a ninguem. */
  readonly customerId: string | null
  /**
   * Esta divida e do CLIENTE — RF-013, migration 0037.
   *
   * Decidido por `core` quando o titulo nasce, e nao deduzido depois da forma
   * de pagamento: o recebivel nao sabe de qual pagamento veio, e a deducao por
   * `MIN(p.method)` lia o fiado de uma venda mista como recebimento em
   * dinheiro. Ver `nasceComoDividaDoCliente`.
   */
  readonly isCustomerDebt: boolean
}

export type NewSettlement = {
  readonly companyId: CompanyId
  readonly payableId: string | null
  readonly receivableId: string | null
  /** Negativo no estorno — a soma das linhas e o saldo baixado. */
  readonly amountCents: number
  readonly method: PaymentMethod | null
  readonly bankAccount: string | null
  readonly settledOn: string
  readonly notes: string | null
  readonly reversesId: string | null
  /**
   * O usuario que registrou, ou `null` quando foi o SISTEMA.
   *
   * A coluna referencia `users`, e o sistema nao e um usuario — gravar ali um
   * id inexistente viola a FK, e inventar um usuario para satisfaze-la seria
   * criar uma pessoa que nao existe. A auditoria, essa, recebe o ator do
   * sistema: e a coluna dela nao tem FK justamente por isso.
   *
   * Ver `system-actor.ts`.
   */
  readonly createdBy: UserId | null
  readonly createdAt: Date
}

/*
 * Inclui a trilha (NR-087): auditar aqui e auditar DENTRO da transacao.
 * O motivo esta em `TransactionalAuditTrail` — fora dela, a trilha
 * sobrevive ao rollback e passa a registrar o que nao aconteceu, e uma
 * segunda conexao por transacao esgota o pool.
 */
export type SettlementTransaction = TransactionalAuditTrail & {
  findPayable(companyId: CompanyId, id: string): Promise<TituloSnapshot | undefined>
  findReceivable(companyId: CompanyId, id: string): Promise<TituloSnapshot | undefined>
  findSettlement(companyId: CompanyId, id: string): Promise<SettlementOutput | undefined>

  /** Ja estornada? Uma baixa so pode ser desfeita uma vez. */
  hasReversal(companyId: CompanyId, settlementId: string): Promise<boolean>

  insertSettlement(baixa: NewSettlement): Promise<SettlementOutput>

  /**
   * Grava o novo total baixado e a situacao do titulo.
   *
   * Os dois juntos, e nao a situacao calculada na leitura, porque a consulta
   * de lista filtra por status e um filtro que precisa recalcular nao usa
   * indice. A situacao vem de `domain`, entao as duas fontes nao divergem.
   */
  updateTitulo(
    companyId: CompanyId,
    tipo: 'payable' | 'receivable',
    id: string,
    settledAmountCents: number,
    status: string,
  ): Promise<void>

  /**
   * Move o saldo devedor do cliente — RF-066, RF-067.
   *
   * `delta` assinado: negativo quando ele paga, positivo quando um estorno
   * devolve a divida.
   *
   * **Nada no sistema INCREMENTA este saldo hoje.** A venda no fiado deveria
   * aumenta-lo e `registerSale` nao o toca — nao ha escritor de saldo nas
   * portas dele. Isto esta registrado no PR da NR-029: a baixa esta certa, e a
   * outra metade do fiado (RF-013) e uma tarefa que falta.
   */
  adjustCustomerBalance(companyId: CompanyId, customerId: string, deltaCents: number): Promise<void>
}

/**
 * Leitura das baixas de um titulo — RF-067.
 *
 * Fora da transacao de escrita: e consulta, e o estorno que vier depois abre a
 * sua propria.
 *
 * Existe porque **o estorno aponta para a BAIXA, e nao para o titulo**, e
 * nenhuma listagem de titulo carregava os ids das baixas. A tela mostrava um
 * botao de estornar sem ter o que mandar para a api — e chamava um falso. Ligar
 * a baixa de verdade sem isto deixaria o estorno mentindo ao lado dela.
 */
export type SettlementQueries = {
  listByTitulo(
    companyId: CompanyId,
    tipo: 'payable' | 'receivable',
    tituloId: string,
  ): Promise<readonly SettlementOutput[]>
}

export type SettlementUnitOfWork = {
  transaction<T>(companyId: CompanyId, fn: (tx: SettlementTransaction) => Promise<T>): Promise<T>
}
