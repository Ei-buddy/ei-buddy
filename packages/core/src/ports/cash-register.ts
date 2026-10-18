import type {
  CashMovementInput,
  CashMovementOutput,
  CashSessionOutput,
  CashSummary,
} from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/** O caixa da loja — NR-157. Ver `apps/.../0039_caixa.sql`. */
export type CashRegister = {
  findOpen(companyId: CompanyId): Promise<CashSessionOutput | undefined>

  /** `'ja_aberto'` quando a loja ja tem caixa aberto (indice unico). */
  open(abertura: {
    readonly companyId: CompanyId
    readonly openingCents: number
    readonly notes: string | null
    readonly openedBy: UserId
    readonly openedAt: Date
  }): Promise<CashSessionOutput | 'ja_aberto'>

  addMovement(
    companyId: CompanyId,
    sessionId: string,
    movimento: CashMovementInput & { readonly createdBy: UserId; readonly createdAt: Date },
  ): Promise<CashMovementOutput>

  /**
   * O que aconteceu no caixa desde a abertura ate `ate`: movimentos e as
   * vendas por forma (sem troco, sem estornadas).
   */
  activity(
    companyId: CompanyId,
    session: CashSessionOutput,
    ate: Date,
  ): Promise<Pick<CashSummary, 'movements' | 'salesByMethod' | 'salesCount'>>

  close(
    companyId: CompanyId,
    sessionId: string,
    fechamento: {
      readonly expectedCents: number
      readonly countedCents: number
      readonly notes: string | null
      readonly closedBy: UserId
      readonly closedAt: Date
    },
  ): Promise<CashSessionOutput>

  /** Os caixas mais recentes, do mais novo ao mais velho. */
  list(companyId: CompanyId, limite: number): Promise<readonly CashSessionOutput[]>
}
