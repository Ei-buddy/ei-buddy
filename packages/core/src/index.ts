/**
 * NUCLEO — casos de uso.
 *
 * Toda operacao de negocio vive aqui, com transacao, autorizacao e auditoria.
 * Recebe (deps, ExecutionContext, input) e nao sabe se a chamada veio do
 * aplicativo ou do WhatsApp. Tambem e aqui que as PORTAS dos adapters sao
 * declaradas. Ver docs/arquitetura/principios.md#1-core-e-o-nucleo
 *
 * A agenda (NR-034) e o primeiro caso de uso completo e serve de molde para os
 * proximos: porta declarada aqui, repositorio injetado, teste com implementacao
 * em memoria. Cadastros e venda vem com NR-021 e NR-022.
 */
export { AppError, isAppError } from './app-error.js'
export { buildDre } from './accounting/build-dre.js'
export type { BuildDreDeps } from './accounting/build-dre.js'
export { classifyEntry, suggestAccount } from './accounting/classify.js'
export type { Sugestao } from './accounting/classify.js'
export { PLANO_DE_CONTAS_PADRAO } from './accounting/default-chart.js'
export type { ContaPadrao } from './accounting/default-chart.js'
export { createAccount, deleteAccount, renameAccount } from './accounting/manage-accounts.js'
export type { ChartDeps } from './accounting/manage-accounts.js'
export type {
  ChartOfAccountsRepository,
  LancamentoClassificado,
  NewAccount,
} from './ports/chart-of-accounts.js'
export type { AppErrorCode, FieldIssue } from './app-error.js'

export { assertCanWrite, assertSegundoCanal } from './authorization.js'

export type { Channel, CompanyId, ExecutionContext, UseCase, UserId } from './context.js'

/* --- Portas: interfaces que db, worker e os adapters implementam --- */
export type { AppointmentRepository, NewAppointment } from './ports/appointment-repository.js'
export { camposAlterados } from './audit/changed-fields.js'
export type { Alteracao } from './audit/changed-fields.js'
export type { AuditTrail, NewAuditEntry, TransactionalAuditTrail } from './ports/audit-trail.js'
export { adjustStock } from './inventory/adjust-stock.js'
export type { AdjustStockDeps } from './inventory/adjust-stock.js'
export { checkStock, estaAbaixoDoMinimo } from './inventory/check-stock.js'
export type { CheckStockDeps } from './inventory/check-stock.js'
export type {
  InventoryProductSnapshot,
  InventoryQueries,
  InventoryReader,
  InventoryTransaction,
  InventoryUnitOfWork,
  NewInventoryMovement,
} from './ports/inventory-writers.js'
export type { InvoiceIssuer } from './ports/invoice-issuer.js'
export type {
  CompanyChanges,
  CompanyCoordinates,
  CompanyRepository,
  CustomerRepository,
  NewCompany,
  NewCustomer,
  NewProduct,
  ProductRepository,
} from './ports/registration-repositories.js'
export type { CepAddress, CepLookup } from './ports/cep-lookup.js'
export type {
  ConnectionContact,
  ConnectionDirection,
  ConnectionNotifier,
  ConnectionRequests,
  ConnectionRow,
  ConnectionStatus,
  NewConnectionRequest,
  SupplierDirectory,
  SupplierSearchRow,
  SupplierSuggestionRow,
} from './ports/connections.js'
export type {
  CompanySettingsRepository,
  NewReceivable,
  NewSale,
  NewSaleItem,
  NewSalePayment,
  RegisteredSale,
  SaleProductReader,
  SaleProductSnapshot,
  SaleSettings,
  SaleTransaction,
  StockMovementOrigin,
  UnitOfWork,
} from './ports/sale-writers.js'
export type { MessageSender } from './ports/message-sender.js'
export {
  ConnectionActionRefusedError,
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  TargetCompanyUnavailableError,
} from './ports/connections.js'
export { searchSuppliers, suggestSuppliers } from './connections/search-suppliers.js'
export type { SearchSuppliersDeps } from './connections/search-suppliers.js'
export {
  connectionPendingCount,
  endConnection,
  listConnections,
  requestConnection,
  respondToConnection,
} from './connections/manage-connections.js'
export type { ManageConnectionsDeps } from './connections/manage-connections.js'
export { resolveCoordinates } from './registration/geocoding.js'
export {
  InMemoryConnectionNotifier,
  InMemoryConnectionRequests,
  InMemorySupplierDirectory,
} from './connections/fakes.js'
export type { PaymentGateway } from './ports/payment-gateway.js'
export type { ReminderScheduler } from './ports/reminder-scheduler.js'

/* --- Venda — NR-022 --- */
export { createPayable } from './payables/create-payable.js'
export type { CreatePayableDeps } from './payables/create-payable.js'
export { endRecurrence } from './payables/end-recurrence.js'
export type { EndRecurrenceDeps, EndRecurrenceResult } from './payables/end-recurrence.js'
export { listPayables } from './payables/list-payables.js'
export type {
  GrupoDeVencimento,
  ListPayablesDeps,
  PayablesAgrupadas,
} from './payables/list-payables.js'
export type {
  IdGenerator,
  NewPayable,
  PayableFilter,
  PayableQueries,
  PayableTransaction,
  PayableUnitOfWork,
} from './ports/payable-repository.js'
export { listReceivables } from './receivables/list-receivables.js'
export { createReceivable } from './receivables/create-receivable.js'
export type { CreateReceivableDeps } from './receivables/create-receivable.js'
export { InMemoryManualReceivables, InMemoryReceivables } from './receivables/fakes.js'
export type {
  GrupoDeRecebimento,
  ListReceivablesDeps,
  ReceivablesAgrupadas,
} from './receivables/list-receivables.js'
export type {
  ManualReceivableTransaction,
  ManualReceivableUnitOfWork,
  NewManualReceivable,
  ReceivableQueries,
} from './ports/receivable-repository.js'
export { listSettlements } from './settlements/list-settlements.js'
export type { ListSettlementsDeps } from './settlements/list-settlements.js'
export { reverseSettlement } from './settlements/reverse-settlement.js'
export { settlePayable, settleReceivable } from './settlements/settle.js'
export type { SettleDeps } from './settlements/settle.js'
export { mexeNoSaldoDoCliente } from './settlements/customer-balance.js'
export type {
  NewSettlement,
  SettlementQueries,
  SettlementTransaction,
  SettlementUnitOfWork,
  TituloSnapshot,
} from './ports/settlement-writers.js'
export { createDefaultSaleSettings } from './sales/default-settings.js'
export { registerSale } from './sales/register-sale.js'
export type { RegisterSaleDeps, RegisterSaleResult, StockWarning } from './sales/register-sale.js'

/* --- Cadastros — NR-021 --- */
export { registerCompany } from './registration/register-company.js'
export type { RegisterCompanyDeps } from './registration/register-company.js'
export { getCompany, updateCompany } from './registration/manage-company.js'
export type { ManageCompanyDeps } from './registration/manage-company.js'
export {
  assertIdentifiable,
  importCustomers,
  registerCustomer,
} from './registration/register-customer.js'
export type {
  RegisterCustomerDeps,
  RegisterCustomerOptions,
  RegisterCustomerResult,
} from './registration/register-customer.js'
export {
  catalogSummary,
  findProductByBarcode,
  getProduct,
  importProducts,
  generateInternalCode,
  listCatalog,
  productSuggestions,
  registerProduct,
  searchProducts,
  TETO_DO_CATALOGO,
} from './registration/register-product.js'
export type {
  ImportProductsDeps,
  RegisterProductDeps,
  SearchProductsDeps,
} from './registration/register-product.js'

/* --- LGPD: exportacao e anonimizacao — NR-031 --- */
export { anonymizeCustomer, NOME_ANONIMIZADO } from './privacy/anonymize-customer.js'
export type { AnonymizeDeps } from './privacy/anonymize-customer.js'
export {
  COLECOES_DA_EXPORTACAO,
  exportCompanyData,
  LINHAS_POR_PAGINA,
} from './privacy/export-company-data.js'
export type { ExportDeps, ExportResult } from './privacy/export-company-data.js'
export type {
  AnonymizationCounts,
  CustomerPersonalData,
  DataSubjectRepository,
  ExportPage,
  ExportSink,
  ExportSource,
} from './ports/privacy.js'

/* --- Importacao de extrato — NR-047 --- */
export { importStatement } from './banking/import-statement.js'
export type { ImportStatementDeps } from './banking/import-statement.js'
export type {
  BankTransactionWriter,
  NewBankTransaction,
  StatementFile,
  StatementParser,
} from './ports/statement-import.js'

/* --- Autenticacao — NR-014 --- */
export { inviteUser } from './auth/invite-user.js'
export { DURACAO_DA_SESSAO_HORAS, login, logout, selectCompany } from './auth/login.js'
export { loadProfile } from './auth/profile.js'
export type { Profile, ProfileDeps } from './auth/profile.js'
/*
 * Implementacoes de desenvolvimento, exportadas como os adapters falsos de
 * fiscal, whatsapp e payments — a ADR-0002 preve AUTH_PROVIDER=fake para
 * desenvolvimento e teste, e producao recusa subir com ele.
 *
 * As tres sao por instancia e nao sobrevivem a reinicio. Isso NAO e detalhe de
 * teste: e o motivo de a guarda de producao existir.
 */
export {
  FakeIdentityProvider,
  InMemoryLoginThrottle,
  InMemoryPlatformAdminAccess,
  InMemorySessionIssuer,
} from './auth/fakes.js'
/* Idem: a trilha so persiste quando `db` expuser repositorio de auditoria. */
export { InMemoryAuditTrail } from './audit/fakes.js'
export { InMemoryReconciliation } from './reconciliation/fakes.js'
export { InMemoryChartOfAccounts } from './accounting/fakes.js'
export type { AuthDeps, LoginMeta } from './auth/login.js'
export type {
  IdentityProvider,
  LocalUser,
  LoginThrottle,
  SessionClaims,
  SessionIssuer,
  UserDirectory,
  VerifiedIdentity,
} from './ports/identity.js'

/* --- Trilha de auditoria: leitura — US-061 --- */
export { listAuditTrail } from './audit/list-audit-trail.js'
export type { ListAuditTrailDeps } from './audit/list-audit-trail.js'
export type { AuditQueries } from './ports/audit-trail.js'
export { InMemoryAuditQueries } from './audit/fakes.js'

/* --- Super Admin — ADR-0007, RF-131 --- */
export {
  enterCompany,
  exitCompany,
  grantPlatformAdmin,
  revokePlatformAdmin,
  listCompanies as listPlatformCompanies,
  listPlatformAdmins,
  listPlatformUsers,
} from './auth/platform-admin.js'
export type {
  GrantResult as GrantPlatformAdminResult,
  PlatformAdminDeps,
} from './auth/platform-admin.js'
export type { PlatformAdminAccess } from './ports/platform-admin.js'

/* --- Conciliacao bancaria — NR-033 --- */
export {
  createEntryFromTransaction,
  reconcile,
  undoReconciliation,
} from './reconciliation/reconcile.js'
export { JANELA_DE_DIAS, suggestMatches } from './reconciliation/suggest-matches.js'
export { listBankTransactions } from './reconciliation/list-transactions.js'
export type { ListBankTransactionsDeps } from './reconciliation/list-transactions.js'
export type { ReconciliationDeps, SugestaoDeConciliacao } from './reconciliation/suggest-matches.js'
export type {
  BankTransactionSnapshot,
  LancamentoConciliavel,
  NovoLancamentoDeTransacao,
  ReconciliationQueries,
  ReconciliationTransaction,
  ReconciliationUnitOfWork,
} from './ports/reconciliation-repository.js'

/* --- Agenda — NR-034 --- */
export { cancelAppointment } from './schedule/cancel-appointment.js'
export type { CancelAppointmentDeps } from './schedule/cancel-appointment.js'
export { createAppointment, reminderFireAt } from './schedule/create-appointment.js'
export type { CreateAppointmentDeps } from './schedule/create-appointment.js'
export { listDayAppointments } from './schedule/list-day-appointments.js'
export type { DayAgenda, ListDayAppointmentsDeps } from './schedule/list-day-appointments.js'
export { listAppointmentRange } from './schedule/list-appointment-range.js'
export type { ListAppointmentRangeDeps, RangeAgenda } from './schedule/list-appointment-range.js'

/* Cadastro de conta — NR-014, RF-001, RF-002. */
export { signup } from './auth/signup.js'
export type { SignupDeps } from './auth/signup.js'
export type { IdentityRegistrar } from './ports/identity.js'
export { InMemoryCepLookup, InMemoryCompanyRepository } from './registration/fakes.js'

/* O gatilho da emissao — NR-042, RF-045, RF-046. */
export { requestInvoice } from './fiscal/request-invoice.js'
export type { RequestInvoiceDeps } from './fiscal/request-invoice.js'
export type {
  InvoiceQueue,
  ItemFiscalDaVenda,
  SaleFiscalReader,
  VendaParaNota,
} from './ports/sale-fiscal.js'
export { reconcileContingency } from './fiscal/reconcile-contingency.js'
export type {
  ReconcileContingencyDeps,
  ResultadoDaReconciliacao,
} from './fiscal/reconcile-contingency.js'

/* Relatorios de venda — NR-077, US-041. */
export { buildRevenueByMonth } from './reports/revenue-by-month.js'
export type { RevenueReportDeps } from './reports/revenue-by-month.js'
export { rankCustomers, rankProducts } from './reports/rankings.js'
export type { RankingDeps } from './reports/rankings.js'
export type { MesFaturado, Ranking, ReportRepository } from './ports/report-repository.js'

/* Estoque em memoria — o falso da NR-023, usado por teste de rota e composicao
   de desenvolvimento, como os outros falsos deste pacote. */
export { InMemoryInventory } from './inventory/fakes.js'

/* Historico de vendas — NR-027, US-021. */
export { getSale, listSales } from './sales/list-sales.js'
export type { ListSalesDeps } from './sales/list-sales.js'
export type {
  FiltroDoHistorico,
  ItemDoHistorico,
  PagamentoDoHistorico,
  SaleHistoryRepository,
  VendaDoHistorico,
} from './ports/sale-history.js'
export { getCustomer, listCustomers } from './registration/register-customer.js'

/* Chamados de suporte — NR-080, US-062. */
export { getTicket, listTickets, openTicket, readTicket, replyToTicket } from './support/tickets.js'
export type { SupportDeps } from './support/tickets.js'
export type { NewTicket, NewTicketMessage, SupportRepository } from './ports/support-repository.js'

/* CRM — NR-109. */
export { commentOnCrmCard, createCrmCard, listCrmBoard, listTeam, moveCrmCard } from './crm/crm.js'
export type { CrmDeps, TeamDeps } from './crm/crm.js'
export type { CrmRepository, NewCrmCard, NewCrmComment } from './ports/crm-repository.js'
export type { TeamRepository } from './ports/team-repository.js'
export { InMemoryCrm, InMemoryTeam } from './crm/fakes.js'

/* Custos fixos — NR-110. */
export {
  createFixedCost,
  deleteFixedCost,
  listFixedCosts,
  updateFixedCost,
} from './fixed-costs/manage-fixed-costs.js'
export type { FixedCostDeps } from './fixed-costs/manage-fixed-costs.js'
export { generateFixedCostPayables } from './fixed-costs/generate-payables.js'
export type {
  GenerateFixedCostPayablesDeps,
  GenerateFixedCostPayablesResult,
} from './fixed-costs/generate-payables.js'
export { InMemoryFixedCostGenerator, InMemoryFixedCosts } from './fixed-costs/fakes.js'
export type {
  FixedCostChanges,
  FixedCostPayableDraft,
  FixedCostPayableGenerator,
  FixedCostRepository,
  NewFixedCost,
} from './ports/fixed-cost-repository.js'

/* Lista de espera do pre-lancamento — NR-111. */
export { submitWaitlistEntry } from './waitlist/submit-waitlist-entry.js'
export type { SubmitWaitlistEntryDeps } from './waitlist/submit-waitlist-entry.js'
export { getWaitlistStats, listWaitlistEntries } from './waitlist/waitlist-admin.js'
export type { WaitlistAdminDeps } from './waitlist/waitlist-admin.js'
export { InMemoryWaitlist } from './waitlist/fakes.js'
export type {
  Contagem,
  NewWaitlistEntry,
  WaitlistFilter,
  WaitlistRepository,
  WaitlistStats,
} from './ports/waitlist-repository.js'

/* Conta de Parceiro e esquema de cupons — NR-115, ADR-0013. */
export {
  approvePartnerApplication,
  listPendingPartnerApplications,
  rejectPartnerApplication,
} from './partners/review-partner-application.js'
export type { ReviewPartnerApplicationDeps } from './partners/review-partner-application.js'
export { resendPartnerApplication } from './partners/resend-partner-application.js'
export type { ResendPartnerApplicationDeps } from './partners/resend-partner-application.js'
export { getMyPartnerApplication } from './partners/my-partner-application.js'
export type { MyPartnerApplicationDeps } from './partners/my-partner-application.js'
export type { PartnerApplicationRepository } from './ports/partner-application-repository.js'
export { InMemoryPartnerApplicationRepository } from './partners/fakes.js'

/* Consentimento dos documentos legais — RF-02, RF-03, LGPD art. 8 §1. */
export { pendingLegalAcceptance, recordLegalAcceptance } from './legal/legal-consent.js'
export type { LegalConsentDeps, OrigemDoAceite } from './legal/legal-consent.js'
export type { LegalConsentRepository } from './ports/legal-consent-repository.js'
export { InMemoryLegalConsentRepository } from './legal/fakes.js'
