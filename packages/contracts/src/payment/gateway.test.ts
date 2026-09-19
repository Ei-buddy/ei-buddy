import { describe, expect, it } from 'vitest'
import {
  boletoChargeRequestSchema,
  boletoChargeSchema,
  cardChargeRequestSchema,
  cardChargeResultSchema,
  cardHolderSchema,
  cardTokenRequestSchema,
  cardTokenSchema,
  chargeStatusSchema,
  feeQuoteResultSchema,
  feeQuoteSchema,
  paymentEventSchema,
  paymentEventTypeSchema,
  paymentLinkRequestSchema,
  paymentLinkSchema,
  payerSchema,
  pixChargeRequestSchema,
  pixChargeSchema,
  refundRequestSchema,
  refundResultSchema,
  webhookReadResultSchema,
} from './gateway.js'

const AGORA = '2026-09-02T13:00:00.000Z'

const pedidoPix = {
  companyId: 'e1',
  externalReference: 'venda-1',
  amountCents: 12990,
  description: 'Venda 1',
  requestedAt: AGORA,
}

const pedidoLink = {
  companyId: 'e1',
  externalReference: 'recebivel-1',
  amountCents: 5000,
  description: 'Fiado de agosto',
  requestedAt: AGORA,
}

describe('estado de cobranca', () => {
  it.each(['pending', 'authorized', 'refunded', 'expired', 'cancelled', 'failed'])(
    'aceita %s',
    (estado) => {
      expect(chargeStatusSchema.safeParse(estado).success).toBe(true)
    },
  )

  it('nao aceita approved — esse estado nao existe no provedor', () => {
    /* `payment.approved` nunca e disparado; aceita-lo aqui seria convidar o
       codigo a esperar por ele. */
    const r = chargeStatusSchema.safeParse('approved')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Estado de cobranca invalido.')
  })
})

describe('pagador', () => {
  it('aceita ausencia total — cobranca de balcao nao identifica ninguem', () => {
    expect(payerSchema.safeParse({}).success).toBe(true)
  })

  it('normaliza CPF e CNPJ', () => {
    expect(payerSchema.parse({ document: '123.456.789-09' }).document).toBe('12345678909')
    expect(payerSchema.parse({ document: '12.345.678/0001-95' }).document).toBe('12345678000195')
  })

  it('recusa documento que nao e CPF nem CNPJ', () => {
    expect(payerSchema.safeParse({ document: '1234' }).success).toBe(false)
  })
})

describe('pedido de cobranca Pix', () => {
  it('aceita o caso minimo', () => {
    expect(pixChargeRequestSchema.safeParse(pedidoPix).success).toBe(true)
  })

  it('aceita expiracao e pagador identificados', () => {
    const r = pixChargeRequestSchema.safeParse({
      ...pedidoPix,
      expiresAt: '2026-09-02T14:00:00.000Z',
      payer: { name: 'Joao Silva' },
    })
    expect(r.success).toBe(true)
  })

  it('recusa valor zero — cobranca de nada nao existe', () => {
    const r = pixChargeRequestSchema.safeParse({ ...pedidoPix, amountCents: 0 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('O valor da cobranca precisa ser maior que zero.')
    }
  })

  it.each([
    [{ ...pedidoPix, amountCents: -100 }, 'valor negativo'],
    [{ ...pedidoPix, amountCents: 129.9 }, 'decimal em vez de centavos'],
    [{ ...pedidoPix, externalReference: '' }, 'sem referencia externa'],
    [{ ...pedidoPix, companyId: '' }, 'sem empresa'],
    [{ ...pedidoPix, description: '' }, 'sem descricao'],
    [{ ...pedidoPix, requestedAt: '2026-09-02T13:00:00' }, 'instante sem fuso'],
    [{ ...pedidoPix, campoInventado: 1 }, 'campo desconhecido'],
  ])('recusa %o (%s)', (entrada, _motivo) => {
    expect(pixChargeRequestSchema.safeParse(entrada).success).toBe(false)
  })

  it('recusa descricao acima de 140 caracteres', () => {
    const r = pixChargeRequestSchema.safeParse({ ...pedidoPix, description: 'a'.repeat(141) })
    expect(r.success).toBe(false)
  })
})

describe('cobranca Pix', () => {
  const cobranca = {
    chargeId: 'pay_1',
    externalReference: 'venda-1',
    status: 'pending' as const,
    amountCents: 12990,
    qrCodePayload: '00020126...',
    expiresAt: null,
  }

  it('aceita cobranca pendente', () => {
    expect(pixChargeSchema.safeParse(cobranca).success).toBe(true)
  })

  it('exige copia-e-cola — cobranca Pix sem ele nao serve', () => {
    const r = pixChargeSchema.safeParse({ ...cobranca, qrCodePayload: '' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('Cobranca Pix sem copia-e-cola nao serve.')
    }
  })

  it('exige expiresAt explicitamente nulo, nao ausente', () => {
    const { expiresAt: _fora, ...semExpiracao } = cobranca
    expect(pixChargeSchema.safeParse(semExpiracao).success).toBe(false)
  })
})

describe('link de pagamento', () => {
  it('aceita pedido com vencimento', () => {
    const r = paymentLinkRequestSchema.safeParse({ ...pedidoLink, dueDate: '2026-09-10' })
    expect(r.success).toBe(true)
  })

  it('recusa vencimento em formato de instante', () => {
    const r = paymentLinkRequestSchema.safeParse({ ...pedidoLink, dueDate: AGORA })
    expect(r.success).toBe(false)
  })

  it('aceita link com URL valida', () => {
    const r = paymentLinkSchema.safeParse({
      linkId: 'link_1',
      externalReference: 'recebivel-1',
      status: 'pending',
      amountCents: 5000,
      url: 'https://pay.example.com/abc',
      dueDate: '2026-09-10',
    })
    expect(r.success).toBe(true)
  })

  it('recusa link que nao e URL', () => {
    const r = paymentLinkSchema.safeParse({
      linkId: 'link_1',
      externalReference: 'recebivel-1',
      status: 'pending',
      amountCents: 5000,
      url: '/pay/abc',
      dueDate: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Link de pagamento invalido.')
  })
})

describe('estorno', () => {
  const pedido = {
    companyId: 'e1',
    chargeId: 'pay_1',
    reason: 'Devolucao',
    requestedAt: AGORA,
  }

  it('aceita estorno total, sem valor', () => {
    expect(refundRequestSchema.safeParse(pedido).success).toBe(true)
  })

  it('aceita estorno parcial, com valor', () => {
    expect(refundRequestSchema.safeParse({ ...pedido, amountCents: 5000 }).success).toBe(true)
  })

  it('recusa estorno de valor zero', () => {
    expect(refundRequestSchema.safeParse({ ...pedido, amountCents: 0 }).success).toBe(false)
  })

  it('recusa estorno sem motivo', () => {
    expect(refundRequestSchema.safeParse({ ...pedido, reason: '' }).success).toBe(false)
  })

  it('aceita resultado estornado com saldo restante', () => {
    const r = refundResultSchema.safeParse({
      status: 'refunded',
      refundId: 'ref_1',
      chargeId: 'pay_1',
      amountCents: 5000,
      remainingCents: 7990,
      refundedAt: AGORA,
    })
    expect(r.success).toBe(true)
  })

  it('aceita saldo restante zero — estorno total', () => {
    const r = refundResultSchema.safeParse({
      status: 'refunded',
      refundId: 'ref_1',
      chargeId: 'pay_1',
      amountCents: 12990,
      remainingCents: 0,
      refundedAt: AGORA,
    })
    expect(r.success).toBe(true)
  })

  it('aceita resultado recusado', () => {
    const r = refundResultSchema.safeParse({
      status: 'rejected',
      rejection: { code: '422', message: 'Prazo expirado.' },
    })
    expect(r.success).toBe(true)
  })

  it('recusa recusa sem mensagem — a tela precisa dizer algo', () => {
    const r = refundResultSchema.safeParse({
      status: 'rejected',
      rejection: { code: '422', message: '' },
    })
    expect(r.success).toBe(false)
  })
})

describe('cotacao de tarifa', () => {
  it('aceita cotacao na unidade de CardFeeRate', () => {
    const r = feeQuoteSchema.safeParse({ brand: 'visa', installments: 3, feeRatePercent: 4.99 })
    expect(r.success).toBe(true)
  })

  it.each([
    [{ brand: 'visa', installments: 0, feeRatePercent: 3.49 }, 'zero parcelas'],
    [{ brand: 'visa', installments: 22, feeRatePercent: 3.49 }, 'acima de 21 parcelas'],
    [{ brand: 'visa', installments: 3, feeRatePercent: 101 }, 'tarifa acima de 100%'],
    [{ brand: 'visa', installments: 3, feeRatePercent: -1 }, 'tarifa negativa'],
    [{ brand: 'inventada', installments: 3, feeRatePercent: 3.49 }, 'bandeira inexistente'],
  ])('recusa %o (%s)', (entrada, _motivo) => {
    expect(feeQuoteSchema.safeParse(entrada).success).toBe(false)
  })

  it('aceita resultado cotado', () => {
    const r = feeQuoteResultSchema.safeParse({
      status: 'quoted',
      quotes: [{ brand: 'visa', installments: 1, feeRatePercent: 3.49 }],
      settlementDays: 30,
      quotedAt: AGORA,
    })
    expect(r.success).toBe(true)
  })

  it('recusa cotacao vazia — cotacao sem tarifa nao e cotacao', () => {
    const r = feeQuoteResultSchema.safeParse({ status: 'quoted', quotes: [], quotedAt: AGORA })
    expect(r.success).toBe(false)
  })

  it('aceita indisponivel, que e resposta esperada e nao falha', () => {
    const r = feeQuoteResultSchema.safeParse({
      status: 'unavailable',
      reason: 'Provedor nao respondeu.',
    })
    expect(r.success).toBe(true)
  })
})

describe('evento de pagamento', () => {
  it.each(['payment.authorized', 'payment.refunded', 'payment.failed', 'payout.paid'])(
    'aceita %s',
    (tipo) => {
      expect(paymentEventTypeSchema.safeParse(tipo).success).toBe(true)
    },
  )

  it('nao aceita payment.approved — o provedor nunca o dispara', () => {
    /* Aceitar seria criar espaco para o codigo esperar uma baixa que nao vem. */
    expect(paymentEventTypeSchema.safeParse('payment.approved').success).toBe(false)
  })

  it('nao aceita type nulo', () => {
    expect(paymentEventTypeSchema.safeParse(null).success).toBe(false)
  })

  it('aceita evento completo', () => {
    const r = paymentEventSchema.safeParse({
      eventId: 'evt-1',
      type: 'payment.authorized',
      chargeId: 'pay_1',
      externalReference: 'venda-1',
      amountCents: 12990,
      occurredAt: AGORA,
    })
    expect(r.success).toBe(true)
  })

  it('aceita referencia externa nula — repasse nao aponta para venda', () => {
    const r = paymentEventSchema.safeParse({
      eventId: 'evt-1',
      type: 'payout.paid',
      chargeId: 'payout_1',
      externalReference: null,
      amountCents: 100000,
      occurredAt: AGORA,
    })
    expect(r.success).toBe(true)
  })

  it('exige eventId — sem ele a reentrega vira baixa duplicada', () => {
    const r = paymentEventSchema.safeParse({
      eventId: '',
      type: 'payment.authorized',
      chargeId: 'pay_1',
      externalReference: 'venda-1',
      amountCents: 12990,
      occurredAt: AGORA,
    })
    expect(r.success).toBe(false)
  })
})

describe('leitura do webhook', () => {
  it('aceita os quatro estados, que decidem codigos HTTP diferentes', () => {
    const casos = [
      {
        status: 'accepted',
        event: {
          eventId: 'evt-1',
          type: 'payment.authorized',
          chargeId: 'pay_1',
          externalReference: 'venda-1',
          amountCents: 12990,
          occurredAt: AGORA,
        },
      },
      { status: 'ignored', reason: 'Evento sem type.' },
      { status: 'invalid_signature' },
      { status: 'malformed', reason: 'Corpo ilegivel.' },
    ]

    for (const caso of casos) {
      expect(webhookReadResultSchema.safeParse(caso).success).toBe(true)
    }
  })

  it('assinatura invalida nao carrega motivo: nao ha o que contar a quem forjou', () => {
    const r = webhookReadResultSchema.safeParse({
      status: 'invalid_signature',
      reason: 'HMAC nao confere',
    })
    expect(r.success).toBe(false)
  })

  it('recusa estado que nao existe na uniao', () => {
    expect(webhookReadResultSchema.safeParse({ status: 'erro' }).success).toBe(false)
  })
})

const LINHA_FORMATADA = '34191.09008 61713.957308 71444.640008 5 84400000002000'

const pedidoBoleto = {
  companyId: 'e1',
  externalReference: 'venda-2',
  amountCents: 8990,
  description: 'Venda 2',
  dueDate: '2026-09-12',
  requestedAt: AGORA,
}

describe('boleto', () => {
  it('aceita o pedido completo', () => {
    expect(boletoChargeRequestSchema.parse(pedidoBoleto).dueDate).toBe('2026-09-12')
  })

  it('exige vencimento', () => {
    /* O Pix pode nascer sem prazo; o boleto E um titulo com o vencimento
       impresso nele. */
    const { dueDate, ...semVencimento } = pedidoBoleto
    void dueDate
    expect(boletoChargeRequestSchema.safeParse(semVencimento).success).toBe(false)
  })

  it('recusa valor zero', () => {
    expect(boletoChargeRequestSchema.safeParse({ ...pedidoBoleto, amountCents: 0 }).success).toBe(
      false,
    )
  })

  it('normaliza a linha digitavel formatada para digito puro', () => {
    const boleto = boletoChargeSchema.parse({
      chargeId: 'pay_1',
      externalReference: 'venda-2',
      status: 'pending',
      amountCents: 8990,
      dueDate: '2026-09-12',
      digitableLine: LINHA_FORMATADA,
      pdfUrl: 'https://www.asaas.com/b/pdf/pay_1',
    })

    /* Pontuacao e apresentacao. Quem compara ou grava quer os 47 digitos. */
    expect(boleto.digitableLine).toBe('34191090086171395730871444640008584400000002000')
  })

  it('recusa linha digitavel que nao tem 47 digitos', () => {
    const curta = {
      chargeId: 'pay_1',
      externalReference: 'venda-2',
      status: 'pending',
      amountCents: 8990,
      dueDate: '2026-09-12',
      digitableLine: '3419109008',
      pdfUrl: null,
    }
    expect(boletoChargeSchema.safeParse(curta).success).toBe(false)
  })
})

const portador = {
  name: 'Maria da Silva',
  email: 'maria@exemplo.com.br',
  document: '390.533.447-05',
  postalCode: '01310-100',
  addressNumber: '1578',
  phone: '(11) 98765-4321',
}

const pedidoToken = {
  companyId: 'e1',
  customerReference: 'cus_1',
  holderName: 'MARIA DA SILVA',
  number: '4111 1111 1111 1111',
  expiryMonth: '12',
  expiryYear: '2030',
  cvv: '123',
  holder: portador,
  remoteIp: '200.100.50.25',
  requestedAt: AGORA,
}

describe('cartao — tokenizacao', () => {
  it('normaliza numero, documento, CEP e telefone para digito puro', () => {
    const t = cardTokenRequestSchema.parse(pedidoToken)

    /* Formulario entrega com mascara; a rede precisa ver digito puro, ou o
       provedor recusa sem dizer por que. */
    expect(t.number).toBe('4111111111111111')
    expect(t.holder.document).toBe('39053344705')
    expect(t.holder.postalCode).toBe('01310100')
    expect(t.holder.phone).toBe('11987654321')
  })

  it('recusa numero que nao fecha no Luhn', () => {
    /* Barra o erro de digitacao antes de ele virar tentativa negada na conta
       do lojista. */
    expect(
      cardTokenRequestSchema.safeParse({ ...pedidoToken, number: '4111111111111112' }).success,
    ).toBe(false)
  })

  it('recusa numero curto demais para ser cartao', () => {
    expect(cardTokenRequestSchema.safeParse({ ...pedidoToken, number: '4111' }).success).toBe(false)
  })

  it('recusa mes e ano de validade fora do formato', () => {
    expect(cardTokenRequestSchema.safeParse({ ...pedidoToken, expiryMonth: '13' }).success).toBe(
      false,
    )
    expect(cardTokenRequestSchema.safeParse({ ...pedidoToken, expiryYear: '30' }).success).toBe(
      false,
    )
  })

  it('recusa CVV com letra ou tamanho errado', () => {
    expect(cardTokenRequestSchema.safeParse({ ...pedidoToken, cvv: '12a' }).success).toBe(false)
    expect(cardTokenRequestSchema.safeParse({ ...pedidoToken, cvv: '12' }).success).toBe(false)
  })

  it('exige os dados do portador que o antifraude pede', () => {
    /* Sem eles a cobranca e recusada por antifraude, e o lojista le "transacao
       negada" sem entender por que. */
    expect(cardHolderSchema.safeParse({ ...portador, email: 'nao-e-email' }).success).toBe(false)
    expect(cardHolderSchema.safeParse({ ...portador, postalCode: '013' }).success).toBe(false)
    expect(cardHolderSchema.safeParse({ ...portador, document: '123' }).success).toBe(false)
    expect(cardHolderSchema.safeParse({ ...portador, phone: '1198' }).success).toBe(false)
  })

  it('o token guarda so bandeira e ultimos quatro', () => {
    expect(cardTokenSchema.parse({ token: 'tok_1', brand: 'visa', last4: '1111' }).last4).toBe(
      '1111',
    )
    /* last4 com o numero inteiro seria PAN guardado com outro nome. */
    expect(
      cardTokenSchema.safeParse({ token: 'tok_1', brand: 'visa', last4: '4111111111111111' })
        .success,
    ).toBe(false)
  })
})

const pedidoCartao = {
  companyId: 'e1',
  externalReference: 'venda-3',
  amountCents: 24000,
  description: 'Venda 3',
  dueDate: '2026-09-03',
  token: 'tok_1',
  installments: 3,
  remoteIp: '200.100.50.25',
  requestedAt: AGORA,
}

describe('cartao — cobranca', () => {
  it('aceita o pedido com total e numero de parcelas', () => {
    const c = cardChargeRequestSchema.parse(pedidoCartao)
    /* amountCents e o TOTAL. Trocar por parcela cobraria 3x a venda. */
    expect(c.amountCents).toBe(24000)
    expect(c.installments).toBe(3)
  })

  it('recusa parcelamento fora da faixa', () => {
    expect(cardChargeRequestSchema.safeParse({ ...pedidoCartao, installments: 0 }).success).toBe(
      false,
    )
    expect(cardChargeRequestSchema.safeParse({ ...pedidoCartao, installments: 22 }).success).toBe(
      false,
    )
  })

  it('exige IP de quem digitou o cartao', () => {
    /* Mandar o IP do nosso servidor faria toda compra do pais parecer vir do
       mesmo lugar — o padrao que o antifraude procura. */
    const { remoteIp, ...semIp } = pedidoCartao
    void remoteIp
    expect(cardChargeRequestSchema.safeParse(semIp).success).toBe(false)
  })

  it('recusa e resultado, com codigo e mensagem', () => {
    const r = cardChargeResultSchema.parse({
      status: 'declined',
      decline: { code: 'invalid_credit_card', message: 'Cartao sem limite.' },
    })
    if (r.status !== 'declined') throw new Error('esperava recusa')
    expect(r.decline.message).toBe('Cartao sem limite.')
  })

  it('autorizada carrega a cobranca inteira', () => {
    const r = cardChargeResultSchema.parse({
      status: 'authorized',
      charge: {
        chargeId: 'pay_1',
        externalReference: 'venda-3',
        status: 'authorized',
        amountCents: 24000,
        installments: 3,
        brand: 'visa',
        last4: '1111',
      },
    })
    if (r.status !== 'authorized') throw new Error('esperava autorizada')
    expect(r.charge.amountCents).toBe(24000)
  })
})
