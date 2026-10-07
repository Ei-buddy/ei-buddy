import type { QuoteOutput } from '@na-regua/contracts'
import type { CompanyId } from '../context.js'
import type { NewQuote, QuoteRepository } from '../ports/quote-repository.js'

type Produto = {
  id: string
  companyId: CompanyId
  description: string
  isActive: boolean
  code?: string
  costPriceCents?: number
  stock?: number
}

/** Orcamentos em memoria, com numero por loja e fechamento so de aberto — NR-159. */
export class InMemoryQuotes implements QuoteRepository {
  private readonly produtos: Produto[] = []
  private readonly orcamentos: (QuoteOutput & { companyId: CompanyId })[] = []
  private readonly vendas: { id: string; companyId: CompanyId }[] = []
  private seq = 0

  cadastrar(p: Produto): void {
    this.produtos.push(p)
  }

  registrarVenda(id: string, companyId: CompanyId): void {
    this.vendas.push({ id, companyId })
  }

  async findProducts(companyId: CompanyId, ids: readonly string[]) {
    return this.produtos
      .filter((p) => p.companyId === companyId && ids.includes(p.id))
      .map((p) => ({ id: p.id, description: p.description, isActive: p.isActive }))
  }

  async create(q: NewQuote): Promise<QuoteOutput> {
    this.seq += 1
    const numero = this.orcamentos.filter((o) => o.companyId === q.companyId).length + 1
    const saida: QuoteOutput = {
      id: `orc-${this.seq}`,
      number: numero,
      customerName: q.customerName,
      status: 'open',
      validUntil: q.validUntil,
      notes: q.notes,
      discountCents: q.discountCents,
      totalCents: q.totalCents,
      saleId: null,
      items: q.items.map((i) => {
        const p = this.produtos.find((x) => x.id === i.productId)!
        return {
          ...i,
          code: p.code ?? 'P-1',
          costPriceCents: p.costPriceCents ?? 0,
          stock: p.stock ?? 0,
          isActive: p.isActive,
        }
      }),
      createdAt: q.createdAt.toISOString(),
    }
    this.orcamentos.push({ ...saida, companyId: q.companyId })
    return saida
  }

  async list(companyId: CompanyId, limite: number) {
    return this.orcamentos
      .filter((o) => o.companyId === companyId)
      .slice(-limite)
      .reverse()
  }

  async findById(companyId: CompanyId, id: string) {
    return this.orcamentos.find((o) => o.companyId === companyId && o.id === id) ?? null
  }

  async saleExists(companyId: CompanyId, saleId: string) {
    return this.vendas.some((v) => v.companyId === companyId && v.id === saleId)
  }

  async close(
    companyId: CompanyId,
    id: string,
    d: { status: 'converted' | 'cancelled'; saleId: string | null; closedAt: Date },
  ) {
    const i = this.orcamentos.findIndex(
      (o) => o.companyId === companyId && o.id === id && o.status === 'open',
    )
    if (i < 0) return null
    this.orcamentos[i] = { ...this.orcamentos[i]!, status: d.status, saleId: d.saleId }
    return this.orcamentos[i]!
  }
}
