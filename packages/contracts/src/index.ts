/**
 * Schemas Zod — o contrato unico do sistema.
 *
 * Cada schema serve tres consumidores: valida o corpo HTTP na `api`, e o tipo
 * TypeScript em todo o monorepo, e vira definicao de tool no `agent`. E o que
 * torna estrutural a promessa de que app e WhatsApp fazem a mesma coisa.
 *
 * Valida forma, nunca regra: "o CPF tem 11 digitos" e aqui; "este cliente pode
 * comprar fiado" e `core`.
 */
export * from './accounting/account.js'
export * from './agent/message.js'
export * from './agent/send-charge.js'
export * from './audit/entry.js'
export * from './common/index.js'
export * from './company/company.js'
export * from './connection/connection.js'
export * from './customer/customer.js'
export * from './inventory/movement.js'
export * from './invoice/invoice.js'
export * from './messaging/sender.js'
export * from './auth/auth.js'
export * from './banking/statement.js'
export * from './banking/bank-account.js'
export * from './payable/payable.js'
export * from './receivable/receivable.js'
export * from './privacy/privacy.js'
export * from './reconciliation/reconciliation.js'
export * from './payment/gateway.js'
export * from './product/product.js'
export * from './schedule/appointment.js'
export * from './settlement/settlement.js'
export * from './sale/sale.js'
export * from './fiscal/credentials.js'
export * from './report/report.js'
export * from './support/support.js'
export * from './crm/crm.js'
export * from './team/team.js'
export * from './fixed-cost/fixed-cost.js'
export * from './variable-cost/variable-cost.js'
export * from './waitlist/waitlist.js'
export * from './partners/partner.js'
export * from './legal/legal.js'
export * from './billing/subscription.js'
