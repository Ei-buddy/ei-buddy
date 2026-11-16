import { InMemoryAuditTrail } from '../audit/fakes.js'
import type {
  BankTransactionDirection,
  BankTransactionListItem,
  BankTransactionScope,
  EntryKind,
} from '@na-regua/contracts'
import type { CompanyId } from '../context.js'
import type { InMemorySettlements } from '../settlements/fakes.js'
import type {
  BankTransactionSnapshot,
  ConciliacaoComBaixaTransaction,
  ConciliacaoComBaixaUnitOfWork,
  LancamentoConciliavel,
  NovoLancamentoDeTransacao,
  ReconciliationQueries,
  ReconciliationTransaction,
  ReconciliationUnitOfWork,
} from '../ports/reconciliation-repository.js'

/**
 * Extrato e lancamentos em memoria, com filtro por empresa de verdade.
 *
 * Duas coisas este falso faz questao de imitar do banco, porque sem elas o
 * teste passa por acidente:
 *
 * - `findCandidates` filtra pela JANELA de data. Um falso que devolvesse tudo
 *   deixaria passar um caso de uso que esqueceu de calcular a janela — o filtro
 *   por valor em `core` esconderia a falta.
 * - `link` e condicional. E a escrita que decide o conflito de duas abas
 *   (`link` devolve `false`), e um falso que sempre aceitasse tornaria o teste
 *   de corrida verde sem que a protecao existisse.
 */

type TransacaoGuardada = BankTransactionSnapshot & { readonly companyId: CompanyId }
type LancamentoGuardado = LancamentoConciliavel & { readonly companyId: CompanyId }

export class InMemoryReconciliation implements ReconciliationUnitOfWork, ReconciliationQueries {
  private transacoes: TransacaoGuardada[] = []
  private lancamentos: LancamentoGuardado[] = []
  private sequencia = 0

  /*
   * A trilha vem de FORA, e o parametro e obrigatorio de proposito.
   *
   * Em producao a unidade de trabalho e a trilha compartilham a conexao: a
   * entrada da auditoria entra na mesma transacao do que ela registra
   * (NR-087). Aqui o falso reflete isso compartilhando a INSTANCIA — e exigir
   * o parametro impede o erro de construir dois e nao entender por que a
   * assercao do teste nao acha a entrada.
   */
  constructor(readonly trilha: InMemoryAuditTrail) {}

  /** Liga para simular outra aba conciliando entre a leitura e a escrita. */
  conciliadaPorOutro = false

  adicionarTransacao(
    companyId: CompanyId,
    t: {
      direction: BankTransactionDirection
      amountCents: number
      postedOn: string
      description?: string
      counterparty?: string | null
    },
  ): BankTransactionSnapshot {
    this.sequencia += 1
    const guardada: TransacaoGuardada = {
      id: `btx-${this.sequencia}`,
      companyId,
      externalId: `FITID-${this.sequencia}`,
      direction: t.direction,
      amountCents: t.amountCents,
      postedOn: t.postedOn,
      description: t.description ?? 'lancamento do extrato',
      counterparty: t.counterparty ?? null,
      reconciledEntryKind: null,
      reconciledEntryId: null,
      settlementId: null,
    }
    this.transacoes.push(guardada)
    return guardada
  }

  adicionarLancamento(
    companyId: CompanyId,
    l: {
      entryKind: EntryKind
      counterparty: string
      amountCents: number
      dueDate: string
      netAmountCents?: number | null
      description?: string
      status?: string
      reconciled?: boolean
    },
  ): LancamentoConciliavel {
    this.sequencia += 1
    const guardado: LancamentoGuardado = {
      companyId,
      entryKind: l.entryKind,
      id: `ent-${this.sequencia}`,
      counterparty: l.counterparty,
      description: l.description ?? 'lancamento',
      amountCents: l.amountCents,
      netAmountCents: l.netAmountCents ?? null,
      dueDate: l.dueDate,
      reconciled: l.reconciled ?? false,
      status: l.status ?? 'open',
    }
    this.lancamentos.push(guardado)
    return guardado
  }

  /** O que o teste confere depois de conciliar. */
  /** A baixa da conciliacao — so o falso combinado chama. */
  definirBaixa(transactionId: string, settlementId: string | null): void {
    const i = this.transacoes.findIndex((t) => t.id === transactionId)
    if (i >= 0) this.transacoes[i] = { ...this.transacoes[i]!, settlementId }
  }

  transacao(id: string): BankTransactionSnapshot | undefined {
    return this.transacoes.find((t) => t.id === id)
  }

  lancamento(id: string): LancamentoConciliavel | undefined {
    return this.lancamentos.find((l) => l.id === id)
  }

  quantosLancamentos(): number {
    return this.lancamentos.length
  }

  async findCandidates(
    companyId: CompanyId,
    entryKind: EntryKind,
    de: string,
    ate: string,
  ): Promise<readonly LancamentoConciliavel[]> {
    return this.lancamentos.filter(
      (l) =>
        l.companyId === companyId &&
        l.entryKind === entryKind &&
        l.dueDate >= de &&
        l.dueDate <= ate,
    )
  }

  /**
   * A fila, ordenada da mais antiga para a mais nova — como o repositorio.
   *
   * A ORDEM faz parte do contrato e por isso o falso a imita. Um falso que
   * devolvesse na ordem de insercao deixaria passar um repositorio sem
   * `ORDER BY`: os dois pareceriam concordar enquanto o teste inserisse em
   * ordem cronologica, que e como todo teste insere.
   */
  async listTransactions(
    companyId: CompanyId,
    scope: BankTransactionScope,
  ): Promise<readonly BankTransactionListItem[]> {
    return this.transacoes
      .filter((t) => t.companyId === companyId)
      .filter((t) =>
        scope === 'pending' ? t.reconciledEntryId === null : t.reconciledEntryId !== null,
      )
      .sort((a, b) => a.postedOn.localeCompare(b.postedOn))
      .map((t) => {
        const ligado =
          t.reconciledEntryId === null ? undefined : this.lancamento(t.reconciledEntryId)

        return {
          ...t,
          reconciledWith:
            ligado === undefined
              ? null
              : {
                  kind: ligado.entryKind,
                  id: ligado.id,
                  counterparty: ligado.counterparty,
                  description: ligado.description,
                  dueDate: ligado.dueDate,
                },
        }
      })
  }

  async transaction<T>(
    _companyId: CompanyId,
    fn: (tx: ReconciliationTransaction) => Promise<T>,
  ): Promise<T> {
    /* Copia antes e restaura na falha: o teste da RNF-046 precisa que o falso
       desfaca, senao ele provaria o rollback do nada. */
    /* A trilha faz parte da transacao desde a NR-087: rollback leva a entrada
       da auditoria junto. Sem isto o falso aprovaria uma trilha que registra o
       que nao aconteceu. */
    const trilhaAntes = this.trilha.marcaDeTransacao()
    const antesT = [...this.transacoes]
    const antesL = [...this.lancamentos]

    try {
      return await fn(this.escopo())
    } catch (erro) {
      this.trilha.desfazerAte(trilhaAntes)
      this.transacoes = antesT
      this.lancamentos = antesL
      throw erro
    }
  }

  /*
   * Sem `companyId` proprio: cada metodo da porta recebe a empresa e filtra por
   * ela, e guardar uma copia aqui daria DUAS fontes para a mesma resposta. Se
   * elas divergissem, o falso responderia por uma empresa e afirmaria a outra —
   * exatamente o furo de isolamento que estes testes existem para pegar.
   */
  private escopo(): ReconciliationTransaction {
    return {
      /* A trilha entra NA transacao — NR-087. Ver `TransactionalAuditTrail`. */
      record: (entrada) => this.trilha.record(entrada),

      findTransaction: async (empresa, id) =>
        this.transacoes.find((t) => t.companyId === empresa && t.id === id),

      findEntry: async (empresa, entryKind, id) =>
        this.lancamentos.find(
          (l) => l.companyId === empresa && l.entryKind === entryKind && l.id === id,
        ),

      link: async (empresa, transactionId, entryKind, entryId) => {
        const i = this.transacoes.findIndex(
          (t) => t.companyId === empresa && t.id === transactionId,
        )
        if (i < 0) return false

        /* Condicional, como o `UPDATE ... WHERE reconciled_entry_id IS NULL`
           do repositorio de verdade. */
        if (this.transacoes[i]!.reconciledEntryId !== null || this.conciliadaPorOutro) return false

        this.transacoes[i] = {
          ...this.transacoes[i]!,
          reconciledEntryKind: entryKind,
          reconciledEntryId: entryId,
        }
        this.marcar(entryId, true)
        return true
      },

      unlink: async (empresa, transactionId) => {
        const i = this.transacoes.findIndex(
          (t) => t.companyId === empresa && t.id === transactionId,
        )
        if (i < 0) return

        /* O CHECK `bank_transactions_baixa_so_conciliada` do banco: soltar
           a linha com a baixa da conciliacao ainda presa a ela e recusado. */
        if (this.transacoes[i]!.settlementId !== null) {
          throw new Error('bank_transactions_baixa_so_conciliada')
        }
        const ligado = this.transacoes[i]!.reconciledEntryId
        this.transacoes[i] = {
          ...this.transacoes[i]!,
          reconciledEntryKind: null,
          reconciledEntryId: null,
        }
        if (ligado !== null) this.marcar(ligado, false)
      },

      insertEntry: async (l: NovoLancamentoDeTransacao) => {
        const criado = this.adicionarLancamento(l.companyId, {
          entryKind: l.entryKind,
          counterparty: l.counterparty,
          description: l.description,
          amountCents: l.amountCents,
          dueDate: l.dueDate,
        })
        return { id: criado.id }
      },
    }
  }

  private marcar(entryId: string, reconciled: boolean): void {
    const i = this.lancamentos.findIndex((l) => l.id === entryId)
    if (i >= 0) this.lancamentos[i] = { ...this.lancamentos[i]!, reconciled }
  }
}

/**
 * Conciliacao e baixa na mesma transacao — DEC-026.
 *
 * Compoe os dois falsos, e a transacao de um dentro da do outro: a falha em
 * qualquer ponto desfaz as duas, como o `withTenant` unico do banco. Os dois
 * TEM de ter a mesma trilha — e o que o banco faz, uma conexao so.
 *
 * O titulo existe nos dois falsos com o mesmo id: no da conciliacao como
 * candidato, no da baixa com o saldo. `adicionarTitulo` poe nos dois.
 */
export class InMemoryConciliacaoComBaixa implements ConciliacaoComBaixaUnitOfWork {
  constructor(
    readonly conciliacao: InMemoryReconciliation,
    readonly baixas: InMemorySettlements,
  ) {
    if (conciliacao.trilha !== baixas.trilha) {
      throw new Error('Os dois falsos precisam da mesma trilha, como a mesma conexao no banco.')
    }
  }

  adicionarTitulo(
    companyId: CompanyId,
    t: {
      entryKind: EntryKind
      counterparty: string
      amountCents: number
      dueDate: string
      netAmountCents?: number | null
      settledAmountCents?: number
      status?: string
      customerId?: string | null
      isCustomerDebt?: boolean
    },
  ): LancamentoConciliavel {
    const l = this.conciliacao.adicionarLancamento(companyId, t)
    this.baixas.adicionarTitulo(companyId, t.entryKind, {
      id: l.id,
      amountCents: t.amountCents,
      settledAmountCents: t.settledAmountCents ?? 0,
      status: t.status ?? 'open',
      customerId: t.customerId ?? null,
      isCustomerDebt: t.isCustomerDebt ?? false,
    })
    return l
  }

  async transaction<T>(
    companyId: CompanyId,
    fn: (tx: ConciliacaoComBaixaTransaction) => Promise<T>,
  ): Promise<T> {
    return this.conciliacao.transaction(companyId, (rtx) =>
      this.baixas.transaction(companyId, (stx) =>
        fn({
          ...stx,
          ...rtx,
          /* O lancamento criado do extrato tambem nasce no falso da baixa —
             no banco e a mesma linha. */
          insertEntry: async (l) => {
            const criado = await rtx.insertEntry(l)
            this.baixas.adicionarTitulo(l.companyId, l.entryKind, {
              id: criado.id,
              amountCents: l.amountCents,
              settledAmountCents: 0,
              status: 'open',
              customerId: null,
            })
            return criado
          },
          setSettlement: async (_empresa, transactionId, settlementId) =>
            this.conciliacao.definirBaixa(transactionId, settlementId),
        }),
      ),
    )
  }
}
