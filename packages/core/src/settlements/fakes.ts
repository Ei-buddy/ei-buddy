import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { SettlementOutput } from '@na-regua/contracts'
import type { CompanyId } from '../context.js'
import type {
  NewSettlement,
  SettlementTransaction,
  SettlementUnitOfWork,
  TituloSnapshot,
} from '../ports/settlement-writers.js'

/**
 * Titulos e baixas em memoria, com rollback e filtro por empresa de verdade.
 *
 * O rollback importa mais aqui do que nos outros falsos: a baixa escreve em
 * TRES lugares (a linha da baixa, o titulo e o saldo do cliente), e o que os
 * testes de atomicidade verificam e que nenhum dos tres sobrevive sozinho.
 */

type TituloGuardado = TituloSnapshot & {
  readonly companyId: CompanyId
  readonly tipo: 'payable' | 'receivable'
}

export class InMemorySettlements implements SettlementUnitOfWork {
  private titulos: TituloGuardado[] = []
  private baixas: (SettlementOutput & { readonly companyId: CompanyId })[] = []
  private saldos = new Map<string, number>()
  private sequencia = 0
  /** Liga para simular falha depois de gravar a linha da baixa. */
  falharDepoisDaBaixa = false

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

  adicionarTitulo(
    companyId: CompanyId,
    tipo: 'payable' | 'receivable',
    t: Omit<TituloSnapshot, 'isCustomerDebt'> & { isCustomerDebt?: boolean },
  ): void {
    this.titulos.push({
      ...t,
      isCustomerDebt: t.isCustomerDebt ?? false,
      companyId,
      tipo,
    })
  }

  definirSaldo(customerId: string, cents: number): void {
    this.saldos.set(customerId, cents)
  }

  saldoDe(customerId: string): number {
    return this.saldos.get(customerId) ?? 0
  }

  tituloDe(id: string): TituloSnapshot | undefined {
    return this.titulos.find((t) => t.id === id)
  }

  get totalDeBaixas(): number {
    return this.baixas.length
  }

  /* O escopo nao guarda o `companyId` da transacao: cada metodo da porta ja o
     recebe, e e por ele que o filtro acontece. Duas fontes para a mesma verdade
     e o caminho para elas discordarem — e aqui discordar e vazar entre lojas. */
  async transaction<T>(
    _companyId: CompanyId,
    fn: (tx: SettlementTransaction) => Promise<T>,
  ): Promise<T> {
    /* A trilha faz parte da transacao desde a NR-087: rollback leva a entrada
       da auditoria junto. Sem isto o falso aprovaria uma trilha que registra o
       que nao aconteceu. */
    const trilhaAntes = this.trilha.marcaDeTransacao()
    const titulosAntes = [...this.titulos]
    const baixasAntes = [...this.baixas]
    const saldosAntes = new Map(this.saldos)
    const sequenciaAntes = this.sequencia

    try {
      return await fn(this.escopo())
    } catch (erro) {
      this.trilha.desfazerAte(trilhaAntes)
      this.titulos = titulosAntes
      this.baixas = baixasAntes
      this.saldos = saldosAntes
      this.sequencia = sequenciaAntes
      throw erro
    }
  }

  private acharTitulo(
    companyId: CompanyId,
    tipo: 'payable' | 'receivable',
    id: string,
  ): TituloSnapshot | undefined {
    return this.titulos.find((t) => t.companyId === companyId && t.tipo === tipo && t.id === id)
  }

  private escopo(): SettlementTransaction {
    return {
      /* A trilha entra NA transacao — NR-087. Ver `TransactionalAuditTrail`. */
      record: (entrada) => this.trilha.record(entrada),

      findPayable: async (empresa, id) => this.acharTitulo(empresa, 'payable', id),
      findReceivable: async (empresa, id) => this.acharTitulo(empresa, 'receivable', id),

      findSettlement: async (empresa, id) =>
        this.baixas.find((b) => b.companyId === empresa && b.id === id),

      hasReversal: async (empresa, settlementId) =>
        this.baixas.some((b) => b.companyId === empresa && b.reversesId === settlementId),

      insertSettlement: async (n: NewSettlement) => {
        this.sequencia += 1
        const gravada = {
          id: `set-${this.sequencia}`,
          companyId: n.companyId,
          payableId: n.payableId,
          receivableId: n.receivableId,
          amountCents: n.amountCents,
          method: n.method,
          bankAccount: n.bankAccount,
          settledOn: n.settledOn,
          notes: n.notes,
          reversesId: n.reversesId,
          createdBy: n.createdBy,
          createdAt: n.createdAt.toISOString(),
        }
        this.baixas.push(gravada)

        if (this.falharDepoisDaBaixa) {
          throw new Error('falha simulada depois de gravar a baixa')
        }

        return gravada
      },

      updateTitulo: async (empresa, tipo, id, settledAmountCents, status) => {
        this.titulos = this.titulos.map((t) =>
          t.companyId === empresa && t.tipo === tipo && t.id === id
            ? { ...t, settledAmountCents, status }
            : t,
        )
      },

      adjustCustomerBalance: async (_empresa, customerId, delta) => {
        this.saldos.set(customerId, (this.saldos.get(customerId) ?? 0) + delta)
      },
    }
  }
}
