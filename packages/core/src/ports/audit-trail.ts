import type {
  AuditAction,
  AuditEntryOutput,
  AuditLogEntry,
  AuditQueryInput,
  AuditValues,
} from '@na-regua/contracts'
import type { Channel, CompanyId, UserId } from '../context.js'

/**
 * Porta da trilha de auditoria — NR-025, RF-123.
 *
 * **Somente insercao.** Nao ha `update` nem `delete` nesta porta, e a ausencia
 * e a especificacao: trilha que aceita correcao deixa de ser prova. O banco
 * impoe o mesmo por gatilho (RF-124, `0007_auditoria.sql`), porque uma regra
 * que so existe no tipo e uma regra que o proximo `psql` ignora.
 */

export type NewAuditEntry = {
  readonly companyId: CompanyId
  /** Nome da entidade no glossario: `Customer`, `Sale`, `Product`. */
  readonly entity: string
  readonly entityId: string
  readonly action: AuditAction
  readonly actorId: UserId
  readonly channel: Channel
  readonly occurredAt: Date
  readonly before: AuditValues | null
  readonly after: AuditValues | null
}

export type AuditTrail = {
  record(entrada: NewAuditEntry): Promise<AuditEntryOutput>
}

/**
 * Trilha que participa da transacao do caso de uso.
 *
 * Separada da porta acima porque as duas situacoes sao diferentes de verdade:
 *
 * - Ajustar estoque e registrar o ajuste precisam entrar **juntos**. Saldo
 *   mudado sem trilha e a trilha mentindo.
 * - Registrar que alguem consultou um relatorio nao precisa de transacao
 *   nenhuma.
 *
 * ## Na NR-087 este tipo deixou de ser so uma intencao
 *
 * Ele existia como apelido de `AuditTrail` e nada o usava: os seis casos de
 * uso que auditam dentro da propria transacao chamavam `deps.audit.record`,
 * que e a trilha de fora. Com a trilha em memoria isso nao tinha efeito
 * visivel — o `Map` nao sabe o que e transacao.
 *
 * Com a trilha no banco, teria dois efeitos, e nenhum e sutil:
 *
 * 1. **Trava o banco.** O pool tem 10 conexoes. Dez transacoes simultaneas,
 *    cada uma pedindo uma segunda conexao para a trilha, esperam por uma
 *    decima primeira que nao existe.
 *
 * 2. **A trilha passa a mentir.** Gravada fora, ela sobrevive ao rollback do
 *    que registra: o estorno falha no commit e fica na trilha um estorno que
 *    nunca aconteceu. Trilha que registra o que nao houve nao resolve
 *    divergencia nenhuma, que e exatamente a US-061.
 *
 * Por isso os cinco escopos de transacao (`SaleTransaction`,
 * `InventoryTransaction`, `PayableTransaction`, `ReconciliationTransaction` e
 * `SettlementTransaction`) INCLUEM este tipo. O caso de uso chama
 * `tx.record(...)` quando esta dentro de uma transacao e
 * `deps.audit.record(...)` quando nao esta — e agora a assinatura diz qual dos
 * dois, em vez de deixar implicito.
 */
export type TransactionalAuditTrail = AuditTrail

/**
 * Leitura da trilha — US-061, "quando consulto".
 *
 * Porta SEPARADA de `AuditTrail` de proposito. A de escrita nao tem `update`
 * nem `delete`, e a ausencia deles e a especificacao; juntar leitura ali
 * diluiria isso numa porta que faz duas coisas. Alem disso, quem escreve e
 * todo caso de uso do sistema, e quem le e uma tela so — dependencias
 * diferentes, motivos diferentes para mudar.
 *
 * O isolamento entre lojas NAO e imposto aqui: `audit_logs` tem `company_id` e
 * politica de RLS normal, entao a consulta ve apenas a empresa do contexto.
 * E por isso que o Super Admin so enxerga a trilha de uma loja DEPOIS de
 * entrar nela (ADR-0007) — e essa entrada, por sua vez, exige justificativa e
 * fica registrada. Quem olha a trilha de alguem deixa rastro de que olhou.
 */
export type AuditQueries = {
  list(
    companyId: CompanyId,
    filtro: AuditQueryInput,
  ): Promise<{ readonly entries: readonly AuditLogEntry[]; readonly total: number }>
}
