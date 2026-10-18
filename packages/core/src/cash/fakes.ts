import type { CashMovementOutput, CashSessionOutput, CashSummary } from '@na-regua/contracts'
import type { CompanyId } from '../context.js'
import type { CashRegister } from '../ports/cash-register.js'

type Venda = {
  companyId: CompanyId
  at: Date
  pagamentos: CashSummary['salesByMethod']
  estornada?: boolean
}

/** Caixa em memoria — NR-157. `registrarVenda` simula a venda do PDV. */
export class InMemoryCashRegister implements CashRegister {
  private readonly sessoes: (CashSessionOutput & { companyId: CompanyId })[] = []
  private readonly movimentos: (CashMovementOutput & {
    companyId: CompanyId
    sessionId: string
  })[] = []
  private readonly vendas: Venda[] = []
  private seq = 0

  registrarVenda(v: Venda): void {
    this.vendas.push(v)
  }

  async findOpen(companyId: CompanyId) {
    const s = this.sessoes.find((x) => x.companyId === companyId && x.status === 'open')
    return s === undefined ? undefined : this.sem(s)
  }

  async open(a: Parameters<CashRegister['open']>[0]) {
    if (await this.findOpen(a.companyId)) return 'ja_aberto' as const
    this.seq += 1
    const s = {
      id: `caixa-${this.seq}`,
      companyId: a.companyId,
      status: 'open' as const,
      openingCents: a.openingCents,
      openedAt: a.openedAt.toISOString(),
      closedAt: null,
      expectedCents: null,
      countedCents: null,
      notes: a.notes,
    }
    this.sessoes.push(s)
    return this.sem(s)
  }

  async addMovement(
    companyId: CompanyId,
    sessionId: string,
    m: Parameters<CashRegister['addMovement']>[2],
  ) {
    this.seq += 1
    const mov = {
      id: `mov-${this.seq}`,
      companyId,
      sessionId,
      kind: m.kind,
      amountCents: m.amountCents,
      reason: m.reason,
      createdAt: m.createdAt.toISOString(),
    }
    this.movimentos.push(mov)
    const { companyId: _c, sessionId: _s, ...saida } = mov
    return saida
  }

  async activity(companyId: CompanyId, session: CashSessionOutput, ate: Date) {
    const desde = new Date(session.openedAt).getTime()
    const vendas = this.vendas.filter(
      (v) =>
        v.companyId === companyId &&
        !v.estornada &&
        v.at.getTime() >= desde &&
        v.at.getTime() <= ate.getTime(),
    )
    const porForma = new Map<string, number>()
    for (const v of vendas) {
      for (const p of v.pagamentos)
        porForma.set(p.method, (porForma.get(p.method) ?? 0) + p.amountCents)
    }
    return {
      movements: this.movimentos
        .filter((m) => m.companyId === companyId && m.sessionId === session.id)
        .map(({ companyId: _c, sessionId: _s, ...m }) => m),
      salesByMethod: [...porForma].map(([method, amountCents]) => ({
        method: method as CashSummary['salesByMethod'][number]['method'],
        amountCents,
      })),
      salesCount: vendas.length,
    }
  }

  async close(companyId: CompanyId, sessionId: string, f: Parameters<CashRegister['close']>[2]) {
    const i = this.sessoes.findIndex((s) => s.companyId === companyId && s.id === sessionId)
    const s = {
      ...this.sessoes[i]!,
      status: 'closed' as const,
      expectedCents: f.expectedCents,
      countedCents: f.countedCents,
      closedAt: f.closedAt.toISOString(),
      notes: f.notes ?? this.sessoes[i]!.notes,
    }
    this.sessoes[i] = s
    return this.sem(s)
  }

  async list(companyId: CompanyId, limite: number) {
    return this.sessoes
      .filter((s) => s.companyId === companyId)
      .reverse()
      .slice(0, limite)
      .map((s) => this.sem(s))
  }

  private sem(s: CashSessionOutput & { companyId: CompanyId }): CashSessionOutput {
    const { companyId: _c, ...resto } = s
    return resto
  }
}
