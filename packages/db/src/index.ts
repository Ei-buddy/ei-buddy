/**
 * Schema SQL (baseline 0001–0007), politicas RLS e repositorios.
 *
 * A estrategia de isolamento esta decidida: RLS por linha, `company_id` em toda
 * tabela de negocio mais politica no PostgreSQL — ADR-0001, origem DEC-002.
 * Ver docs/arquitetura/dados.md#multi-tenant para as consequencias que valem
 * para todo o codigo (FORCE ROW LEVEL SECURITY, consulta sem `app.company_id`
 * falha, migrations com papel separado). O catalogo de dominio segue o
 * snapshot 0909; identidade, sessao, cofre e extrato entram as margens
 * (ADR-0006). Nao ha `drizzle-kit`: o runner aplica SQL cru.
 */
export { checkConnection, closeConnection, getClient } from './connection.js'
export type { DatabaseHealth } from './connection.js'

/* --- Migrations: SQL cru, papel com BYPASSRLS — `pnpm db:migrate` --- */
export { lerMigrations, migrate } from './migrate.js'
export type { Migration, MigrationResult } from './migrate.js'

/* --- Repositorios: implementam as portas declaradas por core --- */
export { createAppointmentRepository } from './appointment-repository.js'
export { createSubscriptionRepository } from './subscription-repository.js'
export { createCouponRepository } from './coupon-repository.js'
export { createWebhookInbox } from './webhook-inbox-repository.js'
export { createCustomerChargeRepository } from './customer-charge-repository.js'
export { createCustomerContactRepository } from './customer-contacts-repository.js'
export { createRetrievalStore } from './retrieval-repository.js'
export { createPeerDirectory } from './peer-directory-repository.js'
export { createConfirmationStore } from './confirmation-repository.js'
export {
  createCompanyRepository,
  createCustomerRepository,
  createProductRepository,
} from './registration-repositories.js'
export { createPayableQueries, createPayableUnitOfWork } from './payable-repository.js'
export {
  createManualReceivableUnitOfWork,
  createReceivableRepository,
} from './receivable-repository.js'
export { createChartOfAccountsRepository } from './chart-of-accounts-repository.js'
export {
  createFixedCostPayableGenerator,
  createFixedCostRepository,
} from './fixed-cost-repository.js'
export { createVariableCostRepository } from './variable-cost-repository.js'
export { createBankAccountRepository } from './bank-account-repository.js'
export { createWaitlistRepository } from './waitlist-repository.js'
export { createInvoiceStore } from './invoice-repository.js'
export {
  createBankTransactionWriter,
  createReconciliationQueries,
  createReconciliationUnitOfWork,
} from './bank-transaction-repository.js'
export { createSaleUnitOfWork } from './sale-unit-of-work.js'
export {
  createSaleCancellationUnitOfWork,
  createSaleReturnUnitOfWork,
} from './sale-cancellation.js'

/* Diretorio de usuarios — NR-014. Le por fora da RLS, pelas funcoes auth_* da
   migration 0003; ver user-directory.ts sobre por que isso e necessario. */
export { createUserDirectory } from './user-directory.js'

/* --- Guarda: a conexao da aplicacao pode ignorar RLS? --- */
export { assertRlsEnforced, checkRlsEnforcement } from './rls-guard.js'
export type { RlsStatus } from './rls-guard.js'

/* --- Isolamento: a ponte entre o ExecutionContext e a politica de RLS --- */
export { withPlatformScope, withTenant } from './tenant.js'
export type { TenantId } from './tenant.js'
/* Identidade da conversa vigente — upsert compartilhado (NR-062). */
export { parseConversationKey, upsertConversationIdentity } from './conversation-identity.js'
export type { ConversationIdentity } from './conversation-identity.js'
/* Historico da conversa vigente — store Postgres (NR-062 US2) e expurgo (US5). */
export {
  createConversationPurgeRepository,
  createConversationStore,
} from './conversation-repository.js'
/* Ids de empresa para varredura de plataforma — SECURITY DEFINER, so id. */
export { listCompanyIds } from './list-company-ids.js'

/* Segredo de lojista cifrado em coluna — RF-004, RNF-022, NR-042. */
export { ChaveDeSegredoInvalida, cifrar, decifrar, lerChaveDeSegredo } from './secret-box.js'
export { createFiscalCredentials } from './fiscal-credentials-repository.js'
export { createPaymentCredentials } from './payment-credentials-repository.js'
export type { SituacaoFiscalDaEmpresa } from './fiscal-credentials-repository.js'
export { createSaleFiscalReader } from './sale-fiscal-repository.js'

/* Faturamento e rankings — NR-077, US-041. */
export { createReportRepository } from './report-repository.js'

/* Estoque: ajuste, saldo e trilha — NR-023, RF-022 a RF-024. */
export {
  createInventoryHistory,
  createInventoryQueries,
  createInventoryUnitOfWork,
} from './inventory-repository.js'

/* Historico de vendas — NR-027, US-021. */
export { createSaleHistoryRepository } from './sale-history-repository.js'

/* Chamados de suporte — NR-080, US-062. */
export { createSupportRepository } from './support-repository.js'

/* Trilha de auditoria — NR-087, RF-123, RF-124, US-061. */
export { createAuditQueries, createAuditTrail, gravarTrilha } from './audit-repository.js'

/* Exportacao completa e anonimizacao — NR-086, RF-125, RF-127, RF-128. */
export {
  createDataSubjectRepository,
  createExportSource,
  FORA_DA_EXPORTACAO,
} from './privacy-repository.js'

/* Sessao persistente e desaceleracao de login — NR-083, ADR-0002. */
export { createLoginThrottle, createSessionIssuer } from './session-repository.js'
export { createPasswordResetTokens } from './password-reset-repository.js'
export { createUserContacts } from './user-contacts.js'
export { createPlatformAdminAccess } from './platform-admin-repository.js'
export { createConnectionRequests, createSupplierDirectory } from './connection-repository.js'
/* Conta de Parceiro — NR-115, ADR-0013. */
export { createPartnerApplicationRepository } from './partner-application-repository.js'
/* Consentimento dos documentos legais — RF-02/RF-03, migration 0015. */
export { createLegalConsentRepository } from './legal-consent-repository.js'

/* Baixa e estorno de titulo — NR-029, RF-063 a RF-067. */
export { createSettlementQueries, createSettlementUnitOfWork } from './settlement-repository.js'

/* Quadro de CRM e equipe — NR-109. */
export { createCrmRepository } from './crm-repository.js'
export { createTeamRepository } from './team-repository.js'
