/**
 * Adapter de assinatura SaaS — a NOSSA mensalidade. Implementa a porta
 * `SubscriptionProvider` declarada por `core` sobre `/v3/subscriptions` do
 * Asaas (ADR-0004).
 *
 * Separado de `packages/payments` de proposito: sao dois problemas de negocio
 * distintos — a nossa receita e o dinheiro do lojista. Se a mensalidade migrar
 * de provedor amanha, a cobranca das vendas nao e afetada.
 *
 * O que existe hoje e o FALSO, que satisfaz a porta inteira e reproduz as
 * armadilhas documentadas do provedor. O adapter real e a proxima fatia da
 * NR-063.
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
