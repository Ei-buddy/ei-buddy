import type {
  BankTransactionListItem,
  BankTransactionOutput,
  BankTransactionScope,
  EntryKind,
} from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'
import type { TransactionalAuditTrail } from './audit-trail.js'
import type { SettlementTransaction } from './settlement-writers.js'

/**
 * Portas da conciliacao bancaria — NR-033, RF-078 a RF-080.
 *
 * A fronteira de transacao e o caso de uso, como no resto de `core`. Aqui ela
 * pesa mais que o normal em um lugar: criar o lancamento a partir da transacao
 * (RF-079) e duas escritas — grava o lancamento e amarra a transacao a ele. Se
 * a segunda falhar, sobra um lancamento orfao que ninguem pediu, no meio das
 * contas do lojista, e a transacao continua na fila convidando a repetir a
 * operacao. Duas vezes.
 */

/** A transacao do extrato como esta agora. */
export type BankTransactionSnapshot = BankTransactionOutput

/**
 * Um lancamento candidato a conciliacao.
 *
 * `netAmountCents` vem separado do bruto de proposito. Recebivel de cartao de
 * R$ 100 chega no banco como R$ 97,50: a diferenca e a taxa da adquirente, que
 * o sistema JA calculou na venda (RF-036). Comparar o extrato com o bruto
 * falharia em toda venda no cartao — que e a maioria — e a decisao de qual dos
 * dois valores esperar no banco e regra, entao mora em `core` e nao no SQL.
 */
export type LancamentoConciliavel = {
  readonly entryKind: EntryKind
  readonly id: string
  /** Fornecedor da conta a pagar, ou origem do recebivel. */
  readonly counterparty: string
  readonly description: string
  readonly amountCents: number
  /** Liquido previsto, quando ha taxa. Nulo quando bruto e liquido coincidem. */
  readonly netAmountCents: number | null
  readonly dueDate: string
  /** Ja conciliado com outra transacao? Nao pode entrar como candidato. */
  readonly reconciled: boolean
  /** `cancelled` nao e candidato: conta cancelada nao gera movimento no banco. */
  readonly status: string
}

/** O lancamento a criar a partir da transacao — RF-079. */
export type NovoLancamentoDeTransacao = {
  readonly companyId: CompanyId
  readonly entryKind: EntryKind
  readonly counterparty: string
  readonly description: string
  readonly amountCents: number
  /**
   * Vencimento igual a data do extrato.
   *
   * O dinheiro ja saiu ou entrou: um lancamento criado a partir do extrato
   * nasce com vencimento no dia em que o banco lancou, e nao "hoje". Datar com
   * `ctx.now` colocaria no mes errado toda conciliacao feita no comeco do mes
   * seguinte — que e justamente quando o lojista senta para conciliar.
   */
  readonly dueDate: string
  readonly accountId: string | null
  readonly createdBy: UserId
  readonly createdAt: Date
}

/*
 * Inclui a trilha (NR-087): auditar aqui e auditar DENTRO da transacao.
 * O motivo esta em `TransactionalAuditTrail` — fora dela, a trilha
 * sobrevive ao rollback e passa a registrar o que nao aconteceu, e uma
 * segunda conexao por transacao esgota o pool.
 */
export type ReconciliationTransaction = TransactionalAuditTrail & {
  findTransaction(
    companyId: CompanyId,
    transactionId: string,
  ): Promise<BankTransactionSnapshot | undefined>

  findEntry(
    companyId: CompanyId,
    entryKind: EntryKind,
    entryId: string,
  ): Promise<LancamentoConciliavel | undefined>

  /**
   * Amarra a transacao ao lancamento.
   *
   * Devolve `false` quando a transacao ja estava conciliada — a checagem final
   * e do banco, nao da leitura anterior. Duas abas abertas na mesma transacao
   * passariam as duas pela verificacao em `core` e chegariam aqui juntas; quem
   * decide e a escrita condicional.
   */
  link(
    companyId: CompanyId,
    transactionId: string,
    entryKind: EntryKind,
    entryId: string,
    at: Date,
  ): Promise<boolean>

  /** Solta os dois de volta para a fila — RF-080. */
  unlink(companyId: CompanyId, transactionId: string): Promise<void>

  insertEntry(lancamento: NovoLancamentoDeTransacao): Promise<{ readonly id: string }>
}

/**
 * Conciliar da baixa — DEC-026.
 *
 * Ligar a linha do extrato ao titulo e lancar a baixa sao UMA operacao: o
 * mesmo escopo tem as duas portas, e a baixa usada e a mesma da tela de contas
 * (`lancarBaixa`). Em transacoes separadas, uma falha no meio deixaria o
 * titulo baixado sem conciliacao — ou conciliado e ainda em aberto, que e
 * exatamente o que a DEC-026 veio acabar.
 */
export type ConciliacaoComBaixaTransaction = ReconciliationTransaction &
  SettlementTransaction & {
    /**
     * Guarda a baixa que a conciliacao lancou (nulo limpa). E ela que o
     * desfazer estorna — e so ela: a baixa que a pessoa lancou a mao na tela
     * de contas nao e da conciliacao.
     */
    setSettlement(
      companyId: CompanyId,
      transactionId: string,
      settlementId: string | null,
    ): Promise<void>
  }

export type ConciliacaoComBaixaUnitOfWork = {
  transaction<T>(
    companyId: CompanyId,
    fn: (tx: ConciliacaoComBaixaTransaction) => Promise<T>,
  ): Promise<T>
}

export type ReconciliationUnitOfWork = {
  transaction<T>(
    companyId: CompanyId,
    fn: (tx: ReconciliationTransaction) => Promise<T>,
  ): Promise<T>
}

/** Leitura fora de transacao — a busca de candidatos. */
export type ReconciliationQueries = {
  /**
   * Lancamentos ainda em aberto com vencimento na janela.
   *
   * A divisao de trabalho aqui e deliberada: a JANELA vem na assinatura, o
   * VALOR nao.
   *
   * A janela porque ela e o filtro barato que evita carregar o historico
   * inteiro — o banco tem indice por data e devolve algumas dezenas de linhas.
   * O valor porque comparar com o bruto ou com o liquido e regra (ver
   * `LancamentoConciliavel`), e regra em SQL e regra que nao aparece no teste
   * de `core`: um `COALESCE(net_amount_cents, amount_cents)` escondido na
   * consulta funcionaria, e mudaria de comportamento sem que nenhum teste
   * daqui percebesse.
   *
   * Algumas dezenas de linhas filtradas em memoria custam nada. A regra
   * visivel vale mais.
   */
  findCandidates(
    companyId: CompanyId,
    entryKind: EntryKind,
    de: string,
    ate: string,
  ): Promise<readonly LancamentoConciliavel[]>

  /**
   * A fila — NR-076.
   *
   * Ordenada da MAIS ANTIGA para a mais nova, e nao ao contrario. Transacao
   * antiga sem conferir e a que preocupa: ela e a que ja passou do mes que o
   * contador fechou. Fila com a mais recente no topo empurraria justamente essa
   * para o fim de uma lista que ninguem rola ate o fim.
   *
   * `reconciledWith` volta preenchido so no recorte `reconciled` — na fila
   * ele seria nulo em toda linha, e a junção custaria em todas elas.
   */
  listTransactions(
    companyId: CompanyId,
    scope: BankTransactionScope,
  ): Promise<readonly BankTransactionListItem[]>
}
