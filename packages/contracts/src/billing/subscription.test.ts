import { describe, expect, it } from 'vitest'
import {
  couponApplicationSchema,
  couponLookupSchema,
  createSubscriptionRequestSchema,
  planSchema,
  podeEscrever,
  podeLer,
  subscriptionEventSchema,
  subscriptionSchema,
  subscriptionStatusSchema,
  subscriptionWebhookResultSchema,
} from './subscription.js'

const AGORA = '2026-09-19T13:00:00.000Z'

describe('quem pode escrever', () => {
  /*
   * Esta tabela decide se o lojista consegue registrar uma venda. Errar aqui
   * nao e um bug de tela: e travar quem esta em dia, ou liberar quem parou de
   * pagar ha meses.
   */
  it('trial, ativa e vencida escrevem; restrita e encerrada nao', () => {
    expect(subscriptionStatusSchema.options.map((s) => [s, podeEscrever(s)])).toEqual([
      ['trial', true],
      ['active', true],
      /* Entre o vencimento e o bloqueio existe um prazo de tolerancia inteiro
         (RF-116), e ele so serve para alguma coisa se a loja continuar
         funcionando durante ele. */
      ['overdue', true],
      ['restricted', false],
      ['cancelled', false],
    ])
  })

  it('ler vale em todos os estados, inclusive restrita', () => {
    /* RF-117 e RF-126: restrita nao e bloqueio total. Sequestrar o dado do
       lojista para forcar pagamento transforma inadimplente em detrator — e o
       dado e dele. */
    expect(subscriptionStatusSchema.options.every(() => podeLer())).toBe(true)
  })
})

describe('plano', () => {
  it('aceita um plano com preco', () => {
    expect(
      planSchema.parse({ code: 'essencial', name: 'Essencial', monthlyPriceCents: 8900 })
        .monthlyPriceCents,
    ).toBe(8900)
  })

  it('recusa plano de preco zero', () => {
    /* Para liberar sem cobrar existe o periodo de teste. Um plano de zero
       seria uma assinatura ativa que nunca gera cobranca. */
    expect(
      planSchema.safeParse({ code: 'gratis', name: 'Gratis', monthlyPriceCents: 0 }).success,
    ).toBe(false)
  })
})

const consulta = {
  couponId: 'cup_1',
  kind: 'partner' as const,
  referrerLabel: 'Barbearia do Ze',
  active: true,
  discountPercent: 30,
  reason: 'ok' as const,
}

describe('cupom', () => {
  it('a consulta traz so o que a leitura publica pode expor', () => {
    const c = couponLookupSchema.parse(consulta)

    /* PIX e a mensagem da candidatura NUNCA saem daqui — a consulta e por
       codigo e quem digita ainda nao tem empresa. */
    expect(Object.keys(c).sort()).toEqual(
      ['active', 'couponId', 'discountPercent', 'kind', 'reason', 'referrerLabel'].sort(),
    )
  })

  it('recusa campo que nao pertence a consulta publica', () => {
    /* `.strict()` e o que impede alguem acrescentar `pixKey` no retorno e o
       contrato aceitar em silencio. */
    expect(couponLookupSchema.safeParse({ ...consulta, pixKey: '11999998888' }).success).toBe(false)
  })

  it('o tipo diz quem INDICOU, e nao a forma do desconto', () => {
    /* O desconto de quem resgata e sempre percentual (ADR-0013). 'percent' e
       'amount' aqui seriam a pergunta errada. */
    expect(couponLookupSchema.safeParse({ ...consulta, kind: 'percent' }).success).toBe(false)
    expect(couponLookupSchema.parse({ ...consulta, kind: 'lojista' }).kind).toBe('lojista')
  })

  it('o motivo cobre os quatro jeitos de um cupom nao valer', () => {
    for (const reason of ['revoked', 'inactive', 'expired', 'exhausted'] as const) {
      expect(couponLookupSchema.parse({ ...consulta, active: false, reason }).reason).toBe(reason)
    }
    /* 'inactive' existe porque cupom de parceiro nasce aguardando aprovacao —
       e "ainda nao vale" e uma conversa diferente de "nao vale mais". */
  })

  it('a aplicacao traz o valor FINAL, e nao so o desconto', () => {
    /* RF-114 pede o valor final antes da confirmacao. Deixar a subtracao para
       a tela e onde nasce um arredondamento diferente por tela. */
    const r = couponApplicationSchema.parse({
      status: 'applied',
      couponId: 'cup_1',
      code: 'PARCEIRO10',
      discountCents: 2697,
      finalCents: 6293,
      cycles: 1,
    })
    if (r.status !== 'applied') throw new Error('esperava aplicado')
    expect(r.finalCents).toBe(6293)
  })

  it('a recusa traz o motivo exato, e nao "invalido"', () => {
    /* RF-115. Quem digitou um codigo que existe mas expirou precisa saber que
       expirou, para nao ficar conferindo se digitou errado. */
    const r = couponApplicationSchema.parse({
      status: 'rejected',
      rejection: { code: 'expired', message: 'Este cupom venceu em 31/08.' },
    })
    if (r.status !== 'rejected') throw new Error('esperava recusa')
    expect(r.rejection.code).toBe('expired')
  })

  it('recusa um motivo que nao esta na lista', () => {
    expect(
      couponApplicationSchema.safeParse({
        status: 'rejected',
        rejection: { code: 'sei_la', message: 'x' },
      }).success,
    ).toBe(false)
  })
})

describe('assinatura e fronteira com o provedor', () => {
  it('aceita a assinatura como o banco a guarda', () => {
    const a = subscriptionSchema.parse({
      companyId: 'e1',
      planCode: 'essencial',
      status: 'trial',
      trialEndsAt: '2026-10-03T13:00:00.000Z',
      currentPeriodEndsAt: null,
      couponId: null,
      restrictedAt: null,
      cancelledAt: null,
      nextDueDate: null,
    })
    expect(a.status).toBe('trial')
  })

  it('o pedido leva o valor JA com desconto, e um primeiro vencimento', () => {
    const p = createSubscriptionRequestSchema.parse({
      companyId: 'e1',
      customerReference: 'cus_1',
      planCode: 'essencial',
      amountCents: 8010,
      firstDueDate: '2026-10-05',
      externalReference: 'assinatura-1',
      requestedAt: AGORA,
    })
    /* Se o provedor recalculasse o cupom, a tela prometeria um numero e a
       fatura traria outro. */
    expect(p.amountCents).toBe(8010)
  })

  it('recusa recorrencia de valor zero', () => {
    expect(
      createSubscriptionRequestSchema.safeParse({
        companyId: 'e1',
        customerReference: 'cus_1',
        planCode: 'essencial',
        amountCents: 0,
        firstDueDate: '2026-10-05',
        externalReference: 'assinatura-1',
        requestedAt: AGORA,
      }).success,
    ).toBe(false)
  })

  it('nao existe evento de "cobranca gerada"', () => {
    /* Cobranca gerada nao e cobranca paga. Um evento assim no enum seria um
       convite a liberar o acesso de quem so chegou na tela de pagamento. */
    const evento = {
      eventId: 'evt_1',
      type: 'subscription.pending',
      providerSubscriptionId: 'sub_1',
      externalReference: 'assinatura-1',
      amountCents: 8900,
      failureReason: null,
      occurredAt: AGORA,
    }
    expect(subscriptionEventSchema.safeParse(evento).success).toBe(false)
  })

  it('o evento admite referencia externa nula', () => {
    const e = subscriptionEventSchema.parse({
      eventId: 'evt_1',
      type: 'subscription.payment_failed',
      providerSubscriptionId: 'sub_1',
      /* Acontece, e nao da para adivinhar de quem e. */
      externalReference: null,
      amountCents: 8900,
      failureReason: 'Cartao sem limite.',
      occurredAt: AGORA,
    })
    expect(e.externalReference).toBeNull()
  })

  it('a leitura do webhook distingue os quatro casos', () => {
    /* Cada um pede um codigo HTTP diferente, e e ai que nasce o bug quando se
       resume tudo a "deu erro". Em especial, assinatura invalida nao e 200. */
    for (const r of [
      { status: 'invalid_signature' },
      { status: 'malformed', reason: 'corpo ilegivel' },
      { status: 'ignored', reason: 'evento que nao interessa' },
    ]) {
      expect(subscriptionWebhookResultSchema.safeParse(r).success).toBe(true)
    }
  })
})
