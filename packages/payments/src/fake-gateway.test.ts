import { describe, expect, it } from 'vitest'
import { centavosDeDecimal, createFakePaymentGateway } from './fake-gateway.js'
import { pedidoDePix, verificarContratoDoGateway } from './payment-gateway-contract.js'

verificarContratoDoGateway('FakePaymentGateway', () => createFakePaymentGateway())

const AGORA = '2026-09-02T13:00:00.000Z'

/** Cria a cobranca e confirma por webhook assinado, como acontece de verdade. */
async function cobrancaPaga(gateway: ReturnType<typeof createFakePaymentGateway>, valor = 12990) {
  const cobranca = await gateway.createPixCharge(pedidoDePix({ amountCents: valor }))
  const corpo = gateway.corpoDeWebhook({
    eventId: 'evt-1',
    type: 'payment.authorized',
    chargeId: cobranca.chargeId,
    externalReference: 'venda-1',
    /* Decimal, como o provedor manda. */
    amount: (valor / 100).toFixed(2),
    occurredAt: AGORA,
  })
  const leitura = gateway.readWebhook(corpo, gateway.tokenDeAviso())
  return { cobranca, leitura }
}

describe('webhook — as armadilhas do provedor', () => {
  it('payment.authorized confirma o pagamento', async () => {
    const gateway = createFakePaymentGateway()

    const { cobranca, leitura } = await cobrancaPaga(gateway)

    expect(leitura.status).toBe('accepted')
    if (leitura.status !== 'accepted') return
    expect(leitura.event.type).toBe('payment.authorized')
    expect(leitura.event.chargeId).toBe(cobranca.chargeId)

    const atual = await gateway.getPixCharge({
      companyId: 'empresa-1',
      chargeId: cobranca.chargeId,
    })
    expect(atual?.status).toBe('authorized')
  })

  it('payment.approved e ignorado — o provedor nunca o dispara', async () => {
    const gateway = createFakePaymentGateway()
    const cobranca = await gateway.createPixCharge(pedidoDePix())

    const corpo = gateway.corpoDeWebhook({
      eventId: 'evt-2',
      type: 'payment.approved',
      chargeId: cobranca.chargeId,
      amount: '129.90',
      occurredAt: AGORA,
    })
    const leitura = gateway.readWebhook(corpo, gateway.tokenDeAviso())

    /*
     * Tratar `approved` como confirmacao e esperar para sempre uma baixa que
     * nunca vem. O evento e ignorado — e a cobranca continua pendente.
     */
    expect(leitura.status).toBe('ignored')
    const atual = await gateway.getPixCharge({
      companyId: 'empresa-1',
      chargeId: cobranca.chargeId,
    })
    expect(atual?.status).toBe('pending')
  })

  it('evento com type nulo e ignorado, sem adivinhar pelos campos legados', async () => {
    const gateway = createFakePaymentGateway()
    const cobranca = await gateway.createPixCharge(pedidoDePix())

    const corpo = gateway.corpoDeWebhook({
      eventId: 'evt-3',
      type: null,
      chargeId: cobranca.chargeId,
      amount: '129.90',
      occurredAt: AGORA,
    })
    const leitura = gateway.readWebhook(corpo, gateway.tokenDeAviso())

    /* O corpo tem `event` e `data` preenchidos; o adapter nao olha para eles. */
    expect(leitura.status).toBe('ignored')
    if (leitura.status !== 'ignored') return
    expect(leitura.reason).toContain('type')
  })

  it('reentrega do mesmo evento nao gera segunda baixa', async () => {
    const gateway = createFakePaymentGateway()
    const cobranca = await gateway.createPixCharge(pedidoDePix())
    const corpo = gateway.corpoDeWebhook({
      eventId: 'evt-4',
      type: 'payment.authorized',
      chargeId: cobranca.chargeId,
      amount: '129.90',
      occurredAt: AGORA,
    })
    const assinatura = gateway.tokenDeAviso()

    const primeira = gateway.readWebhook(corpo, assinatura)
    const segunda = gateway.readWebhook(corpo, assinatura)

    /* O provedor reentrega ate 5 vezes; sem isso, uma baixa vira cinco. */
    expect(primeira.status).toBe('accepted')
    expect(segunda.status).toBe('ignored')
  })

  it('o corpo NAO e protegido — quem tem o token manda o que quiser', async () => {
    const gateway = createFakePaymentGateway()
    const cobranca = await gateway.createPixCharge(pedidoDePix())
    const corpo = gateway.corpoDeWebhook({
      eventId: 'evt-5',
      type: 'payment.authorized',
      chargeId: cobranca.chargeId,
      amount: '129.90',
      occurredAt: AGORA,
    })

    /*
     * Registrado de proposito, e nao como aprovacao. O provedor autentica com
     * TOKEN ESTATICO, entao reserializar o corpo nao invalida nada: o que
     * protege e o segredo do token e o `eventId`, que impede reprocessar o
     * mesmo aviso — nunca a integridade do corpo.
     *
     * Este teste existiu ao contrario por um tempo, afirmando um HMAC que o
     * provedor nao faz. Ele passava porque o falso repetia a conta errada dos
     * dois lados.
     */
    const reserializado = JSON.stringify(JSON.parse(corpo), null, 2)

    expect(gateway.readWebhook(reserializado, gateway.tokenDeAviso()).status).toBe('accepted')
  })

  it('corpo ilegivel com assinatura valida e malformado, nao invalido', async () => {
    const gateway = createFakePaymentGateway()
    const corpo = 'isto nao e json'

    const leitura = gateway.readWebhook(corpo, gateway.tokenDeAviso())

    /* A distincao decide o codigo HTTP: 400 aqui, 401 na assinatura. */
    expect(leitura.status).toBe('malformed')
  })

  it('evento sem payment.id e malformado — nao ha como correlacionar', () => {
    const gateway = createFakePaymentGateway()
    const corpo = JSON.stringify({
      event_id: 'evt-6',
      type: 'payment.authorized',
      occurred_at: AGORA,
    })

    const leitura = gateway.readWebhook(corpo, gateway.tokenDeAviso())

    /* Correlacionar por valor ou horario seria dar baixa na cobranca errada. */
    expect(leitura.status).toBe('malformed')
  })

  it('respeita o segredo configurado', async () => {
    const gateway = createFakePaymentGateway({ webhookSecret: 'outro-segredo' })
    const outro = createFakePaymentGateway({ webhookSecret: 'segredo-diferente' })
    const cobranca = await gateway.createPixCharge(pedidoDePix())
    const corpo = gateway.corpoDeWebhook({
      eventId: 'evt-7',
      type: 'payment.authorized',
      chargeId: cobranca.chargeId,
      amount: '129.90',
      occurredAt: AGORA,
    })

    expect(gateway.readWebhook(corpo, gateway.tokenDeAviso()).status).toBe('accepted')
    expect(gateway.readWebhook(corpo, outro.tokenDeAviso()).status).toBe('invalid_signature')
  })
})

describe('estorno', () => {
  it('estorna o total e zera o saldo', async () => {
    const gateway = createFakePaymentGateway()
    const { cobranca } = await cobrancaPaga(gateway)

    const resultado = await gateway.refund({
      companyId: 'empresa-1',
      chargeId: cobranca.chargeId,
      reason: 'Devolucao do produto',
      requestedAt: AGORA,
    })

    expect(resultado.status).toBe('refunded')
    if (resultado.status !== 'refunded') return
    expect(resultado.amountCents).toBe(12990)
    expect(resultado.remainingCents).toBe(0)
  })

  it('estorna parcialmente e deixa saldo estornavel', async () => {
    const gateway = createFakePaymentGateway()
    const { cobranca } = await cobrancaPaga(gateway)

    const primeiro = await gateway.refund({
      companyId: 'empresa-1',
      chargeId: cobranca.chargeId,
      amountCents: 5000,
      reason: 'Devolucao de um item',
      requestedAt: AGORA,
    })
    const segundo = await gateway.refund({
      companyId: 'empresa-1',
      chargeId: cobranca.chargeId,
      amountCents: 7990,
      reason: 'Devolucao do restante',
      requestedAt: AGORA,
    })

    expect(primeiro.status === 'refunded' && primeiro.remainingCents).toBe(7990)
    expect(segundo.status === 'refunded' && segundo.remainingCents).toBe(0)
  })

  it('recusa estorno acima do disponivel, com o valor na mensagem', async () => {
    const gateway = createFakePaymentGateway()
    const { cobranca } = await cobrancaPaga(gateway)

    const resultado = await gateway.refund({
      companyId: 'empresa-1',
      chargeId: cobranca.chargeId,
      amountCents: 20000,
      reason: 'Tentativa acima do pago',
      requestedAt: AGORA,
    })

    expect(resultado.status).toBe('rejected')
    if (resultado.status !== 'rejected') return
    /* A mensagem vai para a tela: dizer quanto sobra e o que resolve. */
    expect(resultado.rejection.message).toContain('129,90')
  })

  it('recusa estorno de cobranca de outra empresa', async () => {
    const gateway = createFakePaymentGateway()
    const { cobranca } = await cobrancaPaga(gateway)

    const resultado = await gateway.refund({
      companyId: 'empresa-2',
      chargeId: cobranca.chargeId,
      reason: 'Estorno de cobranca alheia',
      requestedAt: AGORA,
    })

    expect(resultado.status).toBe('rejected')
    if (resultado.status !== 'rejected') return
    expect(resultado.rejection.code).toBe('LOCAL-NAO-ENCONTRADA')
  })
})

describe('cotacao de tarifas', () => {
  it('responde unavailable por padrao — a cotacao do provedor e instavel', async () => {
    const gateway = createFakePaymentGateway()

    const resultado = await gateway.fetchFeeQuotes({
      companyId: 'empresa-1',
      requestedAt: AGORA,
    })

    expect(resultado.status).toBe('unavailable')
  })

  it('devolve as cotacoes configuradas, na unidade de CardFeeRate', async () => {
    const gateway = createFakePaymentGateway({
      feeQuotes: [
        { brand: 'visa', installments: 1, feeRatePercent: 3.49 },
        { brand: 'visa', installments: 3, feeRatePercent: 4.99 },
      ],
      settlementDays: 30,
    })

    const resultado = await gateway.fetchFeeQuotes({
      companyId: 'empresa-1',
      requestedAt: AGORA,
    })

    expect(resultado.status).toBe('quoted')
    if (resultado.status !== 'quoted') return
    /* Pontos por cem, igual a `CardFeeRate` de domain — quem traduz e core. */
    expect(resultado.quotes[0]?.feeRatePercent).toBe(3.49)
    expect(resultado.settlementDays).toBe(30)
  })
})

describe('falha de infraestrutura', () => {
  it('lanca, para o job ser retentado', async () => {
    const gateway = createFakePaymentGateway({
      falhaDeInfraestrutura: 'credencial da PagMaxx invalida',
    })

    await expect(gateway.createPixCharge(pedidoDePix())).rejects.toThrow('credencial')
  })
})

describe('conversao do decimal do provedor', () => {
  it.each([
    ['129.9', 12990],
    ['129.90', 12990],
    [129.9, 12990],
    ['100.00', 10000],
    [100, 10000],
    ['0.01', 1],
    ['19.99', 1999],
    ['4.35', 435],
    [19.99, 1999],
    ['1.234,56', 123456],
  ])('converte %o em %i centavos', (entrada, esperado) => {
    expect(centavosDeDecimal(entrada)).toBe(esperado)
  })

  it('nao passa por ponto flutuante', () => {
    /*
     * A armadilha nao e que multiplicar por 100 sempre erre — e que erre so as
     * vezes. `129.9 * 100` da 12990 exato, e quem testa com esse valor conclui
     * que multiplicar funciona. Ja `19.99 * 100` da 1998.9999999999998.
     */
    expect(Number.isInteger(129.9 * 100)).toBe(true)
    expect(Number.isInteger(19.99 * 100)).toBe(false)

    /* Truncar o que desviou perde um centavo por venda. */
    expect(Math.trunc(19.99 * 100)).toBe(1998)
    expect(centavosDeDecimal('19.99')).toBe(1999)

    /* E 4.35 desvia para baixo do mesmo jeito. */
    expect(Math.trunc(4.35 * 100)).toBe(434)
    expect(centavosDeDecimal('4.35')).toBe(435)
  })

  it('devolve zero para o que nao e valor', () => {
    expect(centavosDeDecimal(undefined)).toBe(0)
    expect(centavosDeDecimal(null)).toBe(0)
    expect(centavosDeDecimal({})).toBe(0)
  })
})
