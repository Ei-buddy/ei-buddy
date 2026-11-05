import type { PurchaseOutput } from '@na-regua/contracts'
import type { InMemoryAuditTrail } from '../audit/fakes.js'
import type { CompanyId } from '../context.js'
import type { IdGenerator, NewPayable } from '../ports/payable-repository.js'
import type {
  NewPurchaseMovement,
  PurchaseProductSnapshot,
  PurchaseQueries,
  PurchaseTransaction,
  PurchaseUnitOfWork,
} from '../ports/purchase-register.js'

type Produto = PurchaseProductSnapshot & { readonly companyId: CompanyId }
type Conta = NewPayable & {
  id: string
  status: 'open' | 'partially_settled' | 'settled' | 'cancelled'
  settledAmountCents: number
}
type Estado = {
  produtos: Produto[]
  compras: (PurchaseOutput & { companyId: CompanyId })[]
  movimentos: NewPurchaseMovement[]
  contas: Conta[]
  fornecedores: { id: string; companyId: CompanyId; isActive: boolean }[]
}

/** Entrada de mercadoria em memoria, com rollback de verdade — NR-158. */
export class InMemoryPurchases implements PurchaseUnitOfWork, PurchaseQueries, IdGenerator {
  private estado: Estado = {
    produtos: [],
    compras: [],
    movimentos: [],
    contas: [],
    fornecedores: [],
  }
  private seq = 0
  /** Liga para simular falha no fim da transacao. */
  falharNoFim = false

  constructor(readonly trilha: InMemoryAuditTrail) {}

  next(): string {
    this.seq += 1
    return `grp-${this.seq}`
  }

  cadastrar(p: Produto): void {
    this.estado.produtos.push(p)
  }

  produto(id: string): Produto | undefined {
    return this.estado.produtos.find((p) => p.id === id)
  }

  get movimentos(): readonly NewPurchaseMovement[] {
    return this.estado.movimentos
  }

  get contas(): readonly Conta[] {
    return this.estado.contas
  }

  cadastrarFornecedor(f: { id: string; companyId: CompanyId; isActive: boolean }): void {
    this.estado.fornecedores.push(f)
  }

  /** Simula um pagamento ja registrado na conta da compra. */
  simularBaixa(contaIndex: number, cents: number): void {
    const c = this.estado.contas[contaIndex]!
    this.estado.contas[contaIndex] = {
      ...c,
      settledAmountCents: cents,
      status: 'partially_settled',
    }
  }

  async list(companyId: CompanyId, limite: number): Promise<readonly PurchaseOutput[]> {
    return this.estado.compras
      .filter((c) => c.companyId === companyId)
      .slice(-limite)
      .reverse()
  }

  async transaction<T>(
    companyId: CompanyId,
    fn: (tx: PurchaseTransaction) => Promise<T>,
  ): Promise<T> {
    const copia = structuredClone(this.estado)
    const marca = this.trilha.marcaDeTransacao()
    const tx: PurchaseTransaction = {
      record: (e) => this.trilha.record(e),
      findProduct: async (empresa, id) => {
        const p = copia.produtos.find((x) => x.id === id && x.companyId === empresa)
        return p === undefined ? undefined : { ...p }
      },
      insertPurchase: async (c) => {
        this.seq += 1
        const saida: PurchaseOutput = {
          id: `cmp-${this.seq}`,
          supplier: c.supplier,
          supplierId: c.supplierId,
          status: 'active',
          cancelledAt: null,
          cancelReason: null,
          invoiceNumber: c.invoiceNumber,
          notes: c.notes,
          totalCents: c.totalCents,
          installments: c.installments,
          items: c.items.map((i) => ({ ...i })),
          createdAt: c.createdAt.toISOString(),
        }
        copia.compras.push({ ...saida, companyId })
        return saida
      },
      updateProduct: async (_empresa, id, m) => {
        const i = copia.produtos.findIndex((p) => p.id === id)
        const p = copia.produtos[i]!
        copia.produtos[i] = {
          ...p,
          costPriceCents: m.costPriceCents,
          stockQuantity: m.stock ?? p.stockQuantity,
        }
      },
      insertMovement: async (m) => {
        copia.movimentos.push(m)
      },
      insertPayables: async (contas) => {
        for (const c of contas) {
          this.seq += 1
          copia.contas.push({ ...c, id: `pag-${this.seq}`, status: 'open', settledAmountCents: 0 })
        }
        return contas.length
      },
      findSupplier: async (empresa, id) =>
        copia.fornecedores.find((f) => f.id === id && f.companyId === empresa),
      findPurchase: async (empresa, id) => {
        const c = copia.compras.find((x) => x.id === id && x.companyId === empresa)
        if (c === undefined) return undefined
        const { companyId: _c, ...saida } = c
        return saida
      },
      payablesOfPurchase: async (_empresa, id) =>
        copia.contas
          .filter((c) => c.purchaseId === id)
          .map((c) => ({ id: c.id, status: c.status, settledAmountCents: c.settledAmountCents })),
      cancelPayables: async (_empresa, ids) => {
        copia.contas = copia.contas.map((c) =>
          ids.includes(c.id) ? { ...c, status: 'cancelled' as const } : c,
        )
      },
      markPurchaseCancelled: async (empresa, id, _quem, quando, motivo) => {
        const i = copia.compras.findIndex((x) => x.id === id && x.companyId === empresa)
        copia.compras[i] = {
          ...copia.compras[i]!,
          status: 'cancelled',
          cancelledAt: quando.toISOString(),
          cancelReason: motivo,
        }
        const { companyId: _c, ...saida } = copia.compras[i]!
        return saida
      },
    }
    try {
      const r = await fn(tx)
      if (this.falharNoFim) throw new Error('falha simulada')
      this.estado = copia
      return r
    } catch (e) {
      this.trilha.desfazerAte(marca)
      throw e
    }
  }
}
