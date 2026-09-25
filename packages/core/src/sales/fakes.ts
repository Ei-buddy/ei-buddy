import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { MovementKind } from '@na-regua/contracts'
import type { CardFeeTable, DiscountPolicy, TaxRules } from '@na-regua/domain'
import type { CompanyId, UserId } from '../context.js'
import type {
  CompanySettingsRepository,
  NewSale,
  RegisteredSale,
  SaleProductSnapshot,
  SaleSettings,
  SaleTransaction,
  UnitOfWork,
} from '../ports/sale-writers.js'

/**
 * Unidade de trabalho em memoria, com ROLLBACK de verdade.
 *
 * O falso simula o desfazer porque e disso que a RNF-046 trata: se qualquer
 * passo falha, nao sobra venda pela metade. Um falso que apenas acumula em
 * arrays passaria no teste de atomicidade sem ter atomicidade nenhuma — e o
 * teste diria que a propriedade existe.
 */

export type VendaGravada = RegisteredSale & {
  readonly companyId: CompanyId
  readonly dados: NewSale
}

/** O que a baixa da venda deixa na trilha de estoque — RF-024. */
export type MovimentoDaVenda = {
  readonly productId: string
  readonly kind: MovementKind
  readonly quantityDelta: number
  readonly balanceAfter: number
  readonly saleId: string
  readonly createdBy: UserId
  readonly createdAt: Date
}

export class InMemoryUnitOfWork implements UnitOfWork {
  readonly vendas: VendaGravada[] = []
  /** Estoque por produto, para conferir a baixa. */
  readonly estoque = new Map<string, number>()
  /** Trilha de estoque gerada pela venda — RF-024. */
  readonly movimentos: MovimentoDaVenda[] = []
  private readonly produtos = new Map<string, SaleProductSnapshot & { companyId: CompanyId }>()
  private sequencia = 0
  /** Liga para simular falha no meio da transacao, depois de gravar a venda. */
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

  adicionarProduto(companyId: CompanyId, produto: SaleProductSnapshot): void {
    this.produtos.set(produto.id, { ...produto, companyId })
    this.estoque.set(produto.id, produto.stockQuantity)
  }

  async transaction<T>(companyId: CompanyId, fn: (tx: SaleTransaction) => Promise<T>): Promise<T> {
    /* Fotografia do estado antes de abrir: e o que o rollback restaura. */
    /* A trilha faz parte da transacao desde a NR-087: rollback leva a entrada
       da auditoria junto. Sem isto o falso aprovaria uma trilha que registra o
       que nao aconteceu. */
    const trilhaAntes = this.trilha.marcaDeTransacao()
    const vendasAntes = [...this.vendas]
    const estoqueAntes = new Map(this.estoque)
    const movimentosAntes = [...this.movimentos]
    const sequenciaAntes = this.sequencia

    try {
      return await fn(this.escopo(companyId))
    } catch (erro) {
      this.trilha.desfazerAte(trilhaAntes)
      this.vendas.length = 0
      this.vendas.push(...vendasAntes)
      this.estoque.clear()
      for (const [k, v] of estoqueAntes) this.estoque.set(k, v)
      this.movimentos.length = 0
      this.movimentos.push(...movimentosAntes)
      this.sequencia = sequenciaAntes
      throw erro
    }
  }

  private readonly saldos = new Map<string, number>()

  private escopo(companyId: CompanyId): SaleTransaction {
    return {
      /* A trilha entra NA transacao — NR-087. Ver `TransactionalAuditTrail`. */
      record: (entrada) => this.trilha.record(entrada),

      products: {
        findManyByIds: async (ids) =>
          ids
            .map((id) => this.produtos.get(id))
            .filter(
              (p): p is SaleProductSnapshot & { companyId: CompanyId } =>
                /* Produto de outra empresa e o mesmo que inexistente. Sem este
                   filtro, o teste de isolamento passaria sem isolamento. */
                p !== undefined && p.companyId === companyId,
            )
            .map(({ companyId: _fora, ...resto }) => resto),
      },

      insertSale: async (venda) => {
        this.sequencia += 1
        const gravada: VendaGravada = {
          id: `venda-${this.sequencia}`,
          number: this.proximoNumeroDaEmpresa(companyId),
          grossAmountCents: venda.grossAmountCents,
          costAmountCents: venda.costAmountCents,
          taxAmountCents: venda.taxAmountCents,
          cardFeeAmountCents: venda.cardFeeAmountCents,
          netAmountCents: venda.netAmountCents,
          changeCents: venda.changeCents,
          createdAt: venda.createdAt.toISOString(),
          companyId,
          dados: venda,
        }
        this.vendas.push(gravada)

        if (this.falharDepoisDeGravar) {
          throw new Error('falha simulada depois de gravar a venda')
        }

        return gravada
      },

      decreaseStock: async (itens, origem) => {
        for (const item of itens) {
          const atual = this.estoque.get(item.productId) ?? 0
          /* Permite negativo: RF-028 deixa o operador prosseguir sem saldo. */
          const novo = atual - item.quantity
          this.estoque.set(item.productId, novo)
          /* A baixa da venda tambem e movimento de estoque — RF-024. */
          this.movimentos.push({
            productId: item.productId,
            kind: 'sale',
            quantityDelta: -item.quantity,
            balanceAfter: novo,
            saleId: origem.saleId,
            createdBy: origem.createdBy,
            createdAt: origem.createdAt,
          })
        }
      },

      findByIdempotencyKey: async (key) => {
        const achada = this.vendas.find(
          (v) => v.companyId === companyId && v.dados.idempotencyKey === key,
        )
        if (!achada) return undefined
        const { companyId: _fora, dados: _dados, ...resto } = achada
        return resto
      },

      /**
       * O saldo devedor do cliente — RF-013.
       *
       * Guardado por cliente, para o teste poder afirmar QUANTO subiu: um
       * espiao que so conta chamadas passaria com o valor errado.
       */
      adjustCustomerBalance: async (customerId, deltaCents) => {
        this.saldos.set(customerId, (this.saldos.get(customerId) ?? 0) + deltaCents)
      },
    }
  }

  /** Quanto o cliente deve, segundo o que esta transacao somou. */
  saldoDe(customerId: string): number {
    return this.saldos.get(customerId) ?? 0
  }

  /**
   * Proximo sequencial POR EMPRESA, como o contador do banco.
   *
   * O `+ 1` e a chamada antes do push: a primeira venda da loja e a numero 1,
   * nao a zero. Sem ele o teste da numeracao reprova — e reprovou.
   */
  private proximoNumeroDaEmpresa(companyId: CompanyId): number {
    return this.vendas.filter((v) => v.companyId === companyId).length + 1
  }
}

/** Configuracao fixa, para o teste variar so o que interessa. */
export class FakeCompanySettingsRepository implements CompanySettingsRepository {
  constructor(
    private readonly settings: SaleSettings = {
      taxRules: { regime: 'simples_nacional', defaultRate: 6 } satisfies TaxRules,
      cardFees: {
        rates: [
          { brand: 'visa', installments: 1, feeRatePercent: 2 },
          { brand: 'visa', installments: 3, feeRatePercent: 5 },
          { brand: 'unknown', installments: 1, feeRatePercent: 3 },
          { brand: 'unknown', installments: 3, feeRatePercent: 6 },
        ],
        settlementDays: 30,
      } satisfies CardFeeTable,
      discountPolicy: { maxDiscountRate: 10 } satisfies DiscountPolicy,
    },
  ) {}

  async forSale(): Promise<SaleSettings> {
    return this.settings
  }
}
