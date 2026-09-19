/**
 * Adapter de assinatura SaaS — a NOSSA mensalidade. Implementa a porta
 * `SubscriptionProvider` declarada por `core` sobre `/v3/subscriptions` do
 * Asaas (ADR-0004).
 *
 * Separado de `packages/payments` de proposito: sao dois problemas de negocio
 * distintos — a nossa receita e o dinheiro do lojista. Se a mensalidade migrar
 * de provedor amanha, a cobranca das vendas nao e afetada.
 *
 * O falso e o real satisfazem a MESMA suite de contrato. O falso serve ao
 * desenvolvimento local, sem credencial; o real fala com a conta-pai.
 *
 * Nada compoe o real ainda: falta o caso de uso que cria a assinatura. Liga-lo
 * antes disso seria configuracao morta com uma chave de producao dentro.
 *
 * A suite de contrato (`subscription-provider-contract.ts`) nao e exportada
 * aqui de proposito: importa `vitest`, que e dependencia de desenvolvimento.
 */
export {
  centavosDeDecimal,
  createFakeSubscriptionProvider,
  FakeSubscriptionProvider,
} from './fake-subscription-provider.js'
export type { FakeSubscriptionProviderOptions } from './fake-subscription-provider.js'

export { criarProvedorDeAssinaturaAsaas } from './asaas-subscription-provider.js'
export type { AmbienteAsaas, AsaasSubscriptionOptions } from './asaas-subscription-provider.js'
