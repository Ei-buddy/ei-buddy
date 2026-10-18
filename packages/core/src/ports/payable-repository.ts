import type { PayableOutput, PayableStatus } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'
import type { TransactionalAuditTrail } from './audit-trail.js'

/**
 * Portas das contas a pagar — NR-028, RF-055 a RF-062.
 *
 * Como em `sale-writers`, a fronteira de transacao e o CASO DE USO: as doze
 * ocorrencias de uma recorrencia entram juntas ou nao entram. Metade delas
 * gravada e pior que nenhuma — o lojista veria uma recorrencia que existe pela
 * metade e nao teria como saber ate quando ela vale.
 */

export type NewPayable = {
  readonly companyId: CompanyId
  readonly supplier: string
  readonly description: string
  readonly amountCents: number
  /** `AAAA-MM-DD`. Conta vence num dia, nao num instante. */
  readonly dueDate: string
  readonly attachmentKey: string | null
  readonly accountId: string | null
  readonly recurrenceId: string | null
  readonly occurrenceNumber: number | null
  readonly occurrenceCount: number | null
  readonly createdBy: UserId
  readonly createdAt: Date
}

export type PayableFilter = {
  /** Vazio traz todas. */
  readonly status?: readonly PayableStatus[]
}

/*
 * Inclui a trilha (NR-087): auditar aqui e auditar DENTRO da transacao.
 * O motivo esta em `TransactionalAuditTrail` — fora dela, a trilha
 * sobrevive ao rollback e passa a registrar o que nao aconteceu, e uma
 * segunda conexao por transacao esgota o pool.
 */
export type PayableTransaction = TransactionalAuditTrail & {
  /** As ocorrencias de uma vez — atomicidade da recorrencia. */
  insertMany(contas: readonly NewPayable[]): Promise<readonly PayableOutput[]>

  /**
   * Cancela as ocorrencias FUTURAS e ainda em aberto de uma recorrencia,
   * preservando as ja pagas — RF-058.
   *
   * O corte por data mora na assinatura, e nao no implementador, porque "a
   * partir de quando" e decisao do caso de uso: ele conhece `ctx.now`, e o
   * repositorio nao deveria conhecer relogio nenhum.
   *
   * Devolve quantas foram canceladas — o caso de uso precisa distinguir
   * "encerrei tres" de "nao havia nada para encerrar".
   */
  cancelFutureOccurrences(
    companyId: CompanyId,
    recurrenceId: string,
    aPartirDe: string,
    cancelledBy: UserId,
    cancelledAt: Date,
  ): Promise<number>

  findByRecurrence(companyId: CompanyId, recurrenceId: string): Promise<readonly PayableOutput[]>
  /** Correcao e cancelamento de um titulo — NR-150. */
  findById(companyId: CompanyId, id: string): Promise<PayableOutput | null>
  update(companyId: CompanyId, id: string, changes: PayableChanges): Promise<PayableOutput>
  cancel(
    companyId: CompanyId,
    id: string,
    cancelledBy: UserId,
    cancelledAt: Date,
  ): Promise<PayableOutput>
}

/** O que a correcao de um titulo pode mudar — so o que se digitou ao lancar. */
export type PayableChanges = {
  readonly supplier?: string | undefined
  readonly description?: string | undefined
  readonly amountCents?: number | undefined
  readonly dueDate?: string | undefined
}

export type PayableUnitOfWork = {
  transaction<T>(companyId: CompanyId, fn: (tx: PayableTransaction) => Promise<T>): Promise<T>
}

/** Leitura fora de transacao — a lista do dia a dia. */
export type PayableQueries = {
  list(companyId: CompanyId, filtro: PayableFilter): Promise<readonly PayableOutput[]>
}

/**
 * Gera o id da recorrencia.
 *
 * Porta, e nao `randomUUID()` direto no caso de uso, pelo mesmo motivo que
 * `ctx.now` existe em vez de `new Date()`: o teste precisa saber o que vai sair
 * para poder afirmar alguma coisa sobre o resultado.
 */
export type IdGenerator = {
  next(): string
}
