import { z } from 'zod'
import {
  dateSchema,
  dateTimeSchema,
  idSchema,
  moneyCentsSchema,
  rateSchema,
} from '../common/primitives.js'

/**
 * Assinatura do SaaS — a NOSSA mensalidade. RF-110 a RF-118.
 *
 * Contrato entre `core` e o adapter `billing`, pelo mesmo motivo estrutural do
 * gateway de pagamento: `adapter-nao-importa-core` proibe `billing` de
 * conhecer `core`, entao o vocabulario comum mora aqui.
 *
 * **Nao confundir com `payment/gateway.ts`.** La e o dinheiro do LOJISTA —
 * Pix, boleto e cartao das vendas dele, que caem na subconta dele. Aqui e a
 * mensalidade que ele paga para nos, na conta-pai. Sao dois adapters para um
 * possivel mesmo fornecedor porque sao dois problemas de negocio: se a
 * mensalidade migrar de provedor amanha, a cobranca das vendas nao e afetada.
 */

/**
 * Os cinco estados, e so eles
 * ([fluxos.md](../../../../docs/arquitetura/fluxos.md#assinatura-e-bloqueio-por-inadimplência)).
 *
 * | Estado       | O que significa                             | Escreve? |
 * | ------------ | ------------------------------------------- | -------- |
 * | `trial`      | testando, ainda sem plano                   | sim      |
 * | `active`     | plano contratado e em dia                   | sim      |
 * | `overdue`    | cobranca venceu; tolerancia correndo        | **sim**  |
 * | `restricted` | tolerancia esgotada                         | nao      |
 * | `cancelled`  | encerrada pelo lojista                      | nao      |
 *
 * **`overdue` ainda escreve, e isso nao e descuido.** Entre o vencimento e o
 * bloqueio existe um prazo de tolerancia inteiro (RF-116), e ele so serve para
 * alguma coisa se a loja continuar funcionando durante ele. Bloquear no
 * vencimento seria nao ter tolerancia nenhuma.
 */
export const subscriptionStatusSchema = z.enum(
  ['trial', 'active', 'overdue', 'restricted', 'cancelled'],
  { error: 'Estado de assinatura invalido.' },
)
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>

/**
 * Restrita **nao** e bloqueio total — RF-117, RF-126.
 *
 * Ler e exportar continuam valendo. Sequestrar o dado do lojista para forcar
 * pagamento contradiz o principio 5 da visao do produto e transforma um
 * cliente inadimplente num detrator — e o dado e dele, nao nosso.
 *
 * Exportado como funcao, e nao como lista de estados espalhada pelas telas:
 * quem pergunta "pode criar lancamento?" pergunta em um lugar so, e um estado
 * novo no enum nao deixa seis telas decidindo cada uma por conta.
 */
export function podeEscrever(status: SubscriptionStatus): boolean {
  return status === 'trial' || status === 'active' || status === 'overdue'
}

/** Ler e exportar valem em TODOS os estados. A funcao existe para dizer isso. */
export function podeLer(): boolean {
  return true
}

/**
 * O plano.
 *
 * `code` e texto e nao ha tabela `plans` — a `subscriptions.plan_code` guarda
 * a string. Um catalogo de planos em banco pagaria por si quando houvesse
 * preco por loja; com uma tabela de precos que muda por release, ele so
 * adicionaria uma migration a cada ajuste.
 */
export const planSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'Codigo do plano obrigatorio.')
      .max(40, 'Codigo do plano muito longo.'),
    name: z.string().trim().min(1, 'Nome do plano obrigatorio.').max(80, 'Nome muito longo.'),
    monthlyPriceCents: moneyCentsSchema.refine((v) => v > 0, {
      message: 'Plano sem preco nao e plano. Para liberar sem cobrar, use o periodo de teste.',
    }),
  })
  .strict()

export type Plan = z.infer<typeof planSchema>

/**
 * Quem indicou — ADR-0013.
 *
 * Nao e o tipo de desconto: o desconto de quem RESGATA e sempre percentual,
 * igual nos dois casos. O que muda e o beneficio de quem INDICOU (comissao
 * recorrente para o parceiro, credito de mes gratis para o lojista), e isso
 * nao atravessa esta porta.
 *
 * Lido da FK preenchida no banco, nunca de um campo que quem cadastra escolhe.
 */
export const couponReferrerKindSchema = z.enum(['partner', 'lojista'], {
  error: 'Tipo de cupom invalido.',
})
export type CouponReferrerKind = z.infer<typeof couponReferrerKindSchema>

/**
 * Por que o cupom foi recusado — RF-115.
 *
 * O requisito pede o **motivo exato**, e nao "cupom invalido": as acoes de
 * quem le sao diferentes — conferir a digitacao, esperar a aprovacao, pedir
 * outro codigo, ou desistir porque alguem chegou antes.
 *
 * Espelha o `reason` de `coupon_lookup` (migration 0024). A decisao mora no
 * SQL, e nao aqui, porque a consulta e PUBLICA por codigo: devolver as colunas
 * cruas transformaria a funcao num contador de resgates de qualquer codigo que
 * alguem adivinhe.
 */
export const couponRejectionCodeSchema = z.enum([
  /** Nao existe, foi digitado errado, ou foi apagado. */
  'not_found',
  /** Existia e foi revogado por quem o emitiu. */
  'revoked',
  /** Cupom de parceiro que ainda nao foi aprovado — pode vir a valer. */
  'inactive',
  /** Passou da validade de calendario. */
  'expired',
  /** A cota acabou — alguem chegou antes. */
  'exhausted',
])
export type CouponRejectionCode = z.infer<typeof couponRejectionCodeSchema>

/**
 * O que `coupon_lookup` devolve — e so isso.
 *
 * **Nao e a linha da tabela `coupons`.** A tabela tem RLS forcada sem
 * politica permissiva (migration 0014), e o unico caminho de leitura e aquela
 * funcao. Modelar a tabela aqui seria descrever algo que ninguem consegue ler.
 *
 * `referrerLabel` e o nome de quem indicou, para a tela dizer "indicado por
 * Barbearia do Ze" — e o unico texto que sai da consulta publica. PIX e
 * mensagem da candidatura nunca saem.
 */
export const couponLookupSchema = z
  .object({
    couponId: idSchema,
    kind: couponReferrerKindSchema,
    referrerLabel: z.string().min(1),
    /** Verdadeiro so quando `reason` e `ok`. Vem calculado do mesmo SQL. */
    active: z.boolean(),
    /** Pontos por cem: `30` = 30%. Sempre percentual (ADR-0013). */
    discountPercent: rateSchema,
    reason: z.union([z.literal('ok'), couponRejectionCodeSchema]),
  })
  .strict()

export type CouponLookup = z.infer<typeof couponLookupSchema>

/**
 * O resultado de aplicar um cupom.
 *
 * Uniao discriminada pela mesma razao do estorno e da nota: recusa e
 * RESULTADO, nao excecao. Cupom expirado e resposta normal de um campo de
 * texto livre, e a tela precisa mostrar o motivo — nao capturar um throw.
 *
 * `finalCents` vem calculado, e nao so o desconto: RF-114 pede o **valor
 * final antes da confirmacao**, e deixar a subtracao para a tela e onde um
 * arredondamento diferente por tela nasce.
 */
export const couponApplicationSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('applied'),
      couponId: idSchema,
      code: z.string().min(1),
      discountCents: moneyCentsSchema,
      finalCents: moneyCentsSchema,
      /**
       * Em quantos ciclos o desconto vale.
       *
       * A ADR-0013 fixa **um**, e o numero vem explicito assim mesmo: a tela
       * precisa dizer qual e, ou o lojista assina esperando desconto para
       * sempre. Deixa-lo implicito no codigo faria a mensagem ser escrita a
       * mao em cada tela.
       */
      cycles: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      rejection: z.object({ code: couponRejectionCodeSchema, message: z.string().min(1) }).strict(),
    })
    .strict(),
])

export type CouponApplication = z.infer<typeof couponApplicationSchema>

/** A assinatura como o sistema a conhece — espelha `subscriptions`. */
export const subscriptionSchema = z
  .object({
    companyId: idSchema,
    planCode: z.string().min(1),
    status: subscriptionStatusSchema,
    /** Preenchido enquanto `status = trial`. */
    trialEndsAt: dateTimeSchema.nullable(),
    currentPeriodEndsAt: dateTimeSchema.nullable(),
    couponId: idSchema.nullable(),
    /** Quando o bloqueio ocorreu. Nulo fora de `restricted`. */
    restrictedAt: dateTimeSchema.nullable(),
    cancelledAt: dateTimeSchema.nullable(),
    nextDueDate: dateSchema.nullable(),
  })
  .strict()

export type Subscription = z.infer<typeof subscriptionSchema>

/* -------------------------------------------------------------------------
 * A fronteira com o provedor
 *
 * Daqui para baixo e o que atravessa a porta `SubscriptionProvider`. Acima e o
 * vocabulario do nosso negocio; abaixo, o minimo para pedir uma recorrencia e
 * entender o que o provedor avisa depois.
 * ---------------------------------------------------------------------- */

export const createSubscriptionRequestSchema = z
  .object({
    companyId: idSchema,
    /**
     * O lojista como CLIENTE nosso, na conta-pai.
     *
     * Nao e o `customers` da loja dele: aqui quem deve somos nos cobrando
     * dele. Confundir os dois faria a mensalidade ser cobrada de um cliente
     * da mercearia.
     */
    customerReference: idSchema,
    planCode: z.string().trim().min(1, 'Plano obrigatorio.').max(40),
    /**
     * O valor JA com o desconto do cupom aplicado.
     *
     * A conta e feita antes, de um lado so, porque RF-114 exige mostrar o
     * valor final antes de confirmar: se o provedor recalculasse, a tela
     * prometeria um numero e a fatura traria outro.
     */
    amountCents: moneyCentsSchema.refine((v) => v > 0, {
      message: 'Recorrencia de zero nao existe.',
    }),
    /** Primeiro vencimento. Os seguintes o provedor gera mensalmente. */
    firstDueDate: dateSchema,
    /** `subscriptions.id` do nosso lado — como o webhook volta a nos achar. */
    externalReference: idSchema,
    requestedAt: dateTimeSchema,
  })
  .strict()

export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>

export const providerSubscriptionSchema = z
  .object({
    /** Vai para `subscriptions.provider_subscription_id`. */
    providerSubscriptionId: idSchema,
    externalReference: idSchema,
    /** Crua, como o provedor a escreve — `subscriptions.provider_status`. */
    providerStatus: z.string().min(1),
    nextDueDate: dateSchema,
  })
  .strict()

export type ProviderSubscription = z.infer<typeof providerSubscriptionSchema>

/**
 * O que o provedor avisa sobre a mensalidade.
 *
 * So os tipos que movem o estado da assinatura. `paid` ativa (RF-112 — e
 * tambem RF-118, restaurar apos confirmacao), `payment_failed` leva a
 * `overdue` (RF-113), `cancelled` encerra.
 *
 * **Nao existe `pending`.** Cobranca gerada nao e cobranca paga, e tratar uma
 * como a outra libera o acesso de quem nao pagou.
 */
export const subscriptionEventTypeSchema = z.enum([
  'subscription.paid',
  'subscription.payment_failed',
  'subscription.cancelled',
])
export type SubscriptionEventType = z.infer<typeof subscriptionEventTypeSchema>

export const subscriptionEventSchema = z
  .object({
    /**
     * O provedor reentrega o mesmo evento. Sem este id, uma ativacao vira
     * varias — e, em cobranca, varias baixas do mesmo ciclo.
     */
    eventId: idSchema,
    type: subscriptionEventTypeSchema,
    providerSubscriptionId: idSchema,
    externalReference: idSchema.nullable(),
    amountCents: moneyCentsSchema,
    /** Motivo da recusa, para a tela mostrar — RF-113. */
    failureReason: z.string().min(1).nullable(),
    occurredAt: dateTimeSchema,
  })
  .strict()

export type SubscriptionEvent = z.infer<typeof subscriptionEventSchema>

/**
 * Leitura do webhook — mesmos quatro casos do gateway de pagamento, e pelo
 * mesmo motivo: cada um pede um codigo HTTP diferente, e assinatura invalida
 * **nao** responde 200 (200 ensina o atacante que o corpo foi aceito).
 */
export const subscriptionWebhookResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('accepted'), event: subscriptionEventSchema }).strict(),
  z.object({ status: z.literal('ignored'), reason: z.string().min(1) }).strict(),
  z.object({ status: z.literal('invalid_signature') }).strict(),
  z.object({ status: z.literal('malformed'), reason: z.string().min(1) }).strict(),
])

export type SubscriptionWebhookResult = z.infer<typeof subscriptionWebhookResultSchema>
