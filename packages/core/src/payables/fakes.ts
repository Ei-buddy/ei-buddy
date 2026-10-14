import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { PayableOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'
import type {
  IdGenerator,
  NewPayable,
  PayableFilter,
  PayableQueries,
  PayableTransaction,
  PayableUnitOfWork,
} from '../ports/payable-repository.js'

/**
 * Contas a pagar em memoria, com rollback e filtro por empresa de verdade.
 *
 * Como nos outros falsos do pacote: um que apenas acumulasse em array passaria
 * no teste de atomicidade sem ter atomicidade, e um que ignorasse `companyId`
 * faria o teste de isolamento medir o vazio.
 */

type Guardada = PayableOutput & {
  readonly companyId: CompanyId
  readonly createdBy: UserId
}

export class InMemoryPayables implements PayableUnitOfWork, PayableQueries, IdGenerator {
  private readonly contas: Guardada[] = []
  private sequencia = 0
  private sequenciaId = 0
  /** Liga para simular falha depois de gravar as ocorrencias. */
  falharDepoisDeGravar = false

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

  /** Ids previsiveis: o teste precisa saber o que vai sair para afirmar algo. */
  next(): string {
    this.sequenciaId += 1
    return `rec-${this.sequenciaId}`
  }

  /** Simula uma baixa ja registrada — so para os testes de correcao (NR-150). */
  simularBaixa(id: string, cents: number): void {
    const i = this.contas.findIndex((c) => c.id === id)
    this.contas[i] = { ...this.contas[i]!, settledAmountCents: cents, status: 'partially_settled' }
  }

  todas(companyId: CompanyId): readonly PayableOutput[] {
    return this.contas.filter((c) => c.companyId === companyId)
  }

  async list(companyId: CompanyId, filtro: PayableFilter): Promise<readonly PayableOutput[]> {
    return this.contas.filter(
      (c) =>
        c.companyId === companyId &&
        (filtro.status === undefined || filtro.status.includes(c.status)),
    )
  }

  async transaction<T>(
    companyId: CompanyId,
    fn: (tx: PayableTransaction) => Promise<T>,
  ): Promise<T> {
    /* A trilha faz parte da transacao desde a NR-087: rollback leva a entrada
       da auditoria junto. Sem isto o falso aprovaria uma trilha que registra o
       que nao aconteceu. */
    const trilhaAntes = this.trilha.marcaDeTransacao()
    const antes = [...this.contas]
    const sequenciaAntes = this.sequencia

    try {
      return await fn(this.escopo(companyId))
    } catch (erro) {
      this.trilha.desfazerAte(trilhaAntes)
      this.contas.length = 0
      this.contas.push(...antes)
      this.sequencia = sequenciaAntes
      throw erro
    }
  }

  /* O escopo nao usa o `companyId` da transacao: cada metodo da porta ja o
     recebe, e e por ele que o filtro acontece. Manter os dois seria dar duas
     fontes para a mesma verdade — e a hora em que elas discordarem e um
     vazamento entre lojas. */
  private escopo(_companyId: CompanyId): PayableTransaction {
    return {
      /* A trilha entra NA transacao — NR-087. Ver `TransactionalAuditTrail`. */
      record: (entrada) => this.trilha.record(entrada),

      insertMany: async (novas: readonly NewPayable[]) => {
        const gravadas = novas.map((n) => {
          this.sequencia += 1
          const g: Guardada = {
            id: `pay-${this.sequencia}`,
            companyId: n.companyId,
            supplier: n.supplier,
            description: n.description,
            amountCents: n.amountCents,
            settledAmountCents: 0,
            dueDate: n.dueDate,
            status: 'open',
            attachmentKey: n.attachmentKey,
            accountId: n.accountId,
            recurrenceId: n.recurrenceId,
            occurrenceNumber: n.occurrenceNumber,
            occurrenceCount: n.occurrenceCount,
            createdAt: n.createdAt.toISOString(),
            createdBy: n.createdBy,
          }
          this.contas.push(g)
          return g
        })

        if (this.falharDepoisDeGravar) {
          throw new Error('falha simulada depois de gravar as ocorrencias')
        }

        return gravadas
      },

      cancelFutureOccurrences: async (empresa, recurrenceId, aPartirDe) => {
        let canceladas = 0
        for (let i = 0; i < this.contas.length; i += 1) {
          const c = this.contas[i]!
          const alvo =
            c.companyId === empresa &&
            c.recurrenceId === recurrenceId &&
            c.status === 'open' &&
            /* Estritamente DEPOIS de hoje: a que vence hoje continua devida. */
            c.dueDate > aPartirDe
          if (!alvo) continue
          this.contas[i] = { ...c, status: 'cancelled' }
          canceladas += 1
        }
        return canceladas
      },

      findByRecurrence: async (empresa, recurrenceId) =>
        this.contas.filter((c) => c.companyId === empresa && c.recurrenceId === recurrenceId),

      findById: async (empresa, id) =>
        this.contas.find((c) => c.companyId === empresa && c.id === id) ?? null,

      update: async (empresa, id, mudancas) => {
        const i = this.contas.findIndex((c) => c.companyId === empresa && c.id === id)
        const atual = this.contas[i]!
        const definidas = Object.fromEntries(
          Object.entries(mudancas).filter(([, v]) => v !== undefined),
        )
        this.contas[i] = { ...atual, ...definidas }
        return this.contas[i]!
      },

      cancel: async (empresa, id) => {
        const i = this.contas.findIndex((c) => c.companyId === empresa && c.id === id)
        this.contas[i] = { ...this.contas[i]!, status: 'cancelled' }
        return this.contas[i]!
      },
    }
  }
}
