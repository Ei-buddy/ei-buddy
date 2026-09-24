import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ReceivableOutput, ReceivableStatus } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'
import type {
  ManualReceivableTransaction,
  ManualReceivableUnitOfWork,
  NewManualReceivable,
  ReceivableQueries,
} from '../ports/receivable-repository.js'

/**
 * Recebiveis em memoria, para teste do caso de uso.
 *
 * Aplica o filtro por empresa e o de situacao **de verdade**, como o SQL. Um
 * falso que devolvesse tudo faria o teste de isolamento medir o vazio, e
 * deixaria passar um caso de uso que esquecesse de pedir so os abertos — o
 * defeito apareceria como "a lista mostra contas que ja foram recebidas", na
 * loja com historico, que e a que menos pode desconfiar do numero.
 */
export class InMemoryReceivables implements ReceivableQueries {
  private readonly registros: (ReceivableOutput & { companyId: CompanyId })[] = []
  private sequencia = 0

  /** Acrescenta um recebivel. Tudo tem padrao menos o que o teste quer dizer. */
  adicionar(
    companyId: CompanyId,
    dados: Partial<ReceivableOutput> & { dueDate: string },
  ): ReceivableOutput {
    this.sequencia += 1
    const gravado = {
      id: `rec-${this.sequencia}`,
      companyId,
      saleId: null,
      customerId: null,
      customerName: null,
      description: 'Venda no balcao',
      amountCents: 10_000,
      netAmountCents: 10_000,
      settledAmountCents: 0,
      installmentNumber: 1,
      installmentCount: 1,
      status: 'open' as ReceivableStatus,
      createdAt: '2026-09-01T12:00:00.000Z',
      ...dados,
    }
    this.registros.push(gravado)
    return gravado
  }

  async list(
    companyId: CompanyId,
    criterio: { readonly status: readonly ReceivableStatus[]; readonly customerId?: string },
  ): Promise<readonly ReceivableOutput[]> {
    return (
      this.registros
        .filter((r) => r.companyId === companyId)
        .filter((r) => criterio.status.length === 0 || criterio.status.includes(r.status))
        .filter((r) => criterio.customerId === undefined || r.customerId === criterio.customerId)
        /* Ordena como o SQL (`ORDER BY due_date`): um falso sem isso deixaria
         passar uma consulta sem ordenacao. */
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map(({ companyId: _omitido, ...resto }) => resto)
    )
  }
}

type GuardadaManual = ReceivableOutput & {
  readonly companyId: CompanyId
  readonly createdBy: UserId
}

/**
 * Recebivel avulso em memoria, com rollback e filtro por empresa de verdade —
 * mesmo criterio de `InMemoryPayables`.
 *
 * Classe PROPRIA, e nao um metodo a mais em `InMemoryReceivables`: aquela
 * classe implementa a porta de LEITURA usada por varios testes ja escritos, e
 * um construtor pedindo uma trilha (como a escrita exige, via `NR-087`)
 * quebraria todos eles.
 */
export class InMemoryManualReceivables implements ManualReceivableUnitOfWork {
  private readonly registros: GuardadaManual[] = []
  private sequencia = 0

  constructor(readonly trilha: InMemoryAuditTrail) {}

  todas(companyId: CompanyId): readonly ReceivableOutput[] {
    return this.registros.filter((r) => r.companyId === companyId)
  }

  async transaction<T>(
    companyId: CompanyId,
    fn: (tx: ManualReceivableTransaction) => Promise<T>,
  ): Promise<T> {
    const trilhaAntes = this.trilha.marcaDeTransacao()
    const antes = [...this.registros]
    const sequenciaAntes = this.sequencia

    try {
      return await fn(this.escopo(companyId))
    } catch (erro) {
      this.trilha.desfazerAte(trilhaAntes)
      this.registros.length = 0
      this.registros.push(...antes)
      this.sequencia = sequenciaAntes
      throw erro
    }
  }

  private escopo(_companyId: CompanyId): ManualReceivableTransaction {
    return {
      record: (entrada) => this.trilha.record(entrada),

      insert: async (novo: NewManualReceivable) => {
        this.sequencia += 1
        const gravado: GuardadaManual = {
          id: `rec-${this.sequencia}`,
          companyId: novo.companyId,
          saleId: null,
          customerId: novo.customerId,
          customerName: null,
          description: novo.description,
          amountCents: novo.amountCents,
          netAmountCents: novo.amountCents,
          settledAmountCents: 0,
          dueDate: novo.dueDate,
          installmentNumber: 1,
          installmentCount: 1,
          status: 'open',
          createdAt: novo.createdAt.toISOString(),
          createdBy: novo.createdBy,
        }
        this.registros.push(gravado)
        return gravado
      },
    }
  }
}
