/**
 * Contador de consumo de IA por empresa — RNF-072, RNF-073, FR-020, NR-060.
 *
 * Estado de processo (sem tabela nesta fatia). A chave e empresa + mes civil.
 * Cada `decide` do LLM conta 1 unidade; o teto `AGENT_MONTHLY_BUDGET_CENTS`
 * e comparado a essa contagem ate a NR-063 precificar tokens.
 */

export type AiUsageCounter = {
  readonly budgetCents: number | undefined
  periodOf(now: Date): string
  unitsOf(companyId: string, now: Date): number
  isOverBudget(companyId: string, now: Date): boolean
  record(companyId: string, now: Date, units?: number): number
}

export const TEXTO_TETO_IA =
  'O teto mensal de IA desta empresa foi atingido. Nada foi gravado. ' +
  'Consultas e acoes que usam o modelo ficam pausadas ate o proximo mes.'

export type InMemoryAiUsageOptions = {
  readonly budgetCents?: number
  readonly timeZone?: string
}

export class InMemoryAiUsageCounter implements AiUsageCounter {
  readonly budgetCents: number | undefined
  private readonly timeZone: string
  private readonly byKey = new Map<string, number>()

  constructor(opcoes: InMemoryAiUsageOptions = {}) {
    this.budgetCents = opcoes.budgetCents
    this.timeZone = opcoes.timeZone ?? 'America/Sao_Paulo'
  }

  periodOf(now: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now)
    const year = parts.find((p) => p.type === 'year')?.value
    const month = parts.find((p) => p.type === 'month')?.value
    return `${year ?? '0000'}-${month ?? '01'}`
  }

  unitsOf(companyId: string, now: Date): number {
    return this.byKey.get(this.key(companyId, now)) ?? 0
  }

  isOverBudget(companyId: string, now: Date): boolean {
    if (this.budgetCents === undefined) return false
    return this.unitsOf(companyId, now) >= this.budgetCents
  }

  record(companyId: string, now: Date, units = 1): number {
    const k = this.key(companyId, now)
    const next = (this.byKey.get(k) ?? 0) + units
    this.byKey.set(k, next)
    return next
  }

  private key(companyId: string, now: Date): string {
    return `${companyId}:${this.periodOf(now)}`
  }
}
