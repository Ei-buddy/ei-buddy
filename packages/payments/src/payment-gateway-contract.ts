import {
  boletoChargeSchema,
  cardChargeResultSchema,
  cardTokenSchema,
  feeQuoteResultSchema,
  paymentLinkSchema,
  pixChargeSchema,
  refundResultSchema,
  webhookReadResultSchema,
  type BoletoCharge,
  type BoletoChargeRequest,
  type CardChargeRequest,
  type CardChargeResult,
  type CardToken,
  type CardTokenRequest,
  type FeeQuoteResult,
  type PaymentLink,
  type PaymentLinkRequest,
  type PixCharge,
  type PixChargeRequest,
  type RefundRequest,
  type RefundResult,
  type WebhookReadResult,
} from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'

/**
 * Suite de contrato da porta `PaymentGateway`.
 *
 * Nao conhece o falso, so a porta — e a promessa do README de que falso e real
 * satisfazem a mesma suite. Quando o adapter PagMaxx entrar (NR-044), ele passa
 * por aqui ou nao e substituivel.
 *
 * Fica de fora, de proposito, tudo que exige o segredo do webhook do adapter
 * (o real le de `PAGMAXX_WEBHOOK_SECRET`) e a injecao de falha do provedor.
 * O que **nao** fica de fora e assinatura invalida: isso e propriedade
 * universal, e vale para qualquer implementacao.
 */

export type GatewaySobTeste = {
  createPixCharge(request: PixChargeRequest): Promise<PixCharge>
  getPixCharge(request: { companyId: string; chargeId: string }): Promise<PixCharge | undefined>
  createBoletoCharge(request: BoletoChargeRequest): Promise<BoletoCharge>
  tokenizeCard(request: CardTokenRequest): Promise<CardToken>
  createCardCharge(request: CardChargeRequest): Promise<CardChargeResult>
  createPaymentLink(request: PaymentLinkRequest): Promise<PaymentLink>
  refund(request: RefundRequest): Promise<RefundResult>
  fetchFeeQuotes(request: { companyId: string; requestedAt: string }): Promise<FeeQuoteResult>
  readWebhook(rawBody: string, signature: string): WebhookReadResult
}

const EMPRESA = 'empresa-1'
const OUTRA_EMPRESA = 'empresa-2'
const AGORA = '2026-09-02T13:00:00.000Z'

export function pedidoDePix(sobrescreve: Partial<PixChargeRequest> = {}): PixChargeRequest {
  return {
    companyId: EMPRESA,
    externalReference: 'venda-1',
    amountCents: 12990,
    description: 'Venda 1 — Mercearia',
    requestedAt: AGORA,
    ...sobrescreve,
  }
}

export function pedidoDeBoleto(
  sobrescreve: Partial<BoletoChargeRequest> = {},
): BoletoChargeRequest {
  return {
    companyId: EMPRESA,
    externalReference: 'venda-boleto-1',
    amountCents: 8990,
    description: 'Venda 2 — Mercearia',
    dueDate: '2026-09-12',
    requestedAt: AGORA,
    ...sobrescreve,
  }
}

/**
 * Cartao de teste. `4111 1111 1111 1111` e o numero publico de exemplo das
 * bandeiras — passa no Luhn e nao pertence a ninguem.
 */
export function pedidoDeToken(sobrescreve: Partial<CardTokenRequest> = {}): CardTokenRequest {
  return {
    companyId: EMPRESA,
    customerReference: 'cus_1',
    holderName: 'MARIA DA SILVA',
    number: '4111111111111111',
    expiryMonth: '12',
    expiryYear: '2030',
    cvv: '123',
    holder: {
      name: 'Maria da Silva',
      email: 'maria@exemplo.com.br',
      document: '39053344705',
      postalCode: '01310100',
      addressNumber: '1578',
      phone: '11987654321',
    },
    remoteIp: '200.100.50.25',
    requestedAt: AGORA,
    ...sobrescreve,
  }
}

export function pedidoDeCartao(sobrescreve: Partial<CardChargeRequest> = {}): CardChargeRequest {
  return {
    companyId: EMPRESA,
    externalReference: 'venda-cartao-1',
    amountCents: 24000,
    description: 'Venda 3 — Mercearia',
    dueDate: '2026-09-03',
    token: 'tok_de_teste',
    installments: 3,
    remoteIp: '200.100.50.25',
    requestedAt: AGORA,
    ...sobrescreve,
  }
}

export function pedidoDeLink(sobrescreve: Partial<PaymentLinkRequest> = {}): PaymentLinkRequest {
  return {
    companyId: EMPRESA,
    externalReference: 'recebivel-1',
    amountCents: 5000,
    description: 'Fiado de agosto',
    dueDate: '2026-09-10',
    requestedAt: AGORA,
    ...sobrescreve,
  }
}

export function verificarContratoDoGateway(nome: string, criar: () => GatewaySobTeste): void {
  describe(`contrato PaymentGateway — ${nome}`, () => {
    it('cria cobranca Pix pendente, com copia-e-cola', async () => {
      const gateway = criar()

      const cobranca = await gateway.createPixCharge(pedidoDePix())

      expect(() => pixChargeSchema.parse(cobranca)).not.toThrow()
      /* Nasce pendente: quem confirma e o webhook, nunca a criacao. */
      expect(cobranca.status).toBe('pending')
      expect(cobranca.amountCents).toBe(12990)
      expect(cobranca.qrCodePayload.length).toBeGreaterThan(0)
    })

    it('cobrar a mesma referencia duas vezes devolve a mesma cobranca', async () => {
      const gateway = criar()
      const pedido = pedidoDePix()

      const primeira = await gateway.createPixCharge(pedido)
      const segunda = await gateway.createPixCharge(pedido)

      /* Duas cobrancas para uma divida e cliente pagando duas vezes. */
      expect(segunda.chargeId).toBe(primeira.chargeId)
    })

    it('consulta a cobranca criada', async () => {
      const gateway = criar()
      const criada = await gateway.createPixCharge(pedidoDePix())

      const lida = await gateway.getPixCharge({
        companyId: EMPRESA,
        chargeId: criada.chargeId,
      })

      expect(lida?.chargeId).toBe(criada.chargeId)
    })

    it('cobranca de outra empresa responde como inexistente', async () => {
      const gateway = criar()
      const criada = await gateway.createPixCharge(pedidoDePix())

      const lida = await gateway.getPixCharge({
        companyId: OUTRA_EMPRESA,
        chargeId: criada.chargeId,
      })

      /* Inexistente, nunca "proibido": 403 confirmaria que a cobranca existe. */
      expect(lida).toBeUndefined()
    })

    it('cria boleto com linha digitavel de 47 digitos e vencimento', async () => {
      const gateway = criar()

      const boleto = await gateway.createBoletoCharge(pedidoDeBoleto())

      expect(() => boletoChargeSchema.parse(boleto)).not.toThrow()
      expect(boleto.status).toBe('pending')
      expect(boleto.dueDate).toBe('2026-09-12')
      /* Digito puro: pontuacao e apresentacao, e quem grava ou compara quer os
         47 digitos. */
      expect(boleto.digitableLine).toMatch(/^[0-9]{47}$/)
    })

    it('pedir o mesmo boleto duas vezes devolve o mesmo titulo', async () => {
      const gateway = criar()
      const pedido = pedidoDeBoleto()

      const primeiro = await gateway.createBoletoCharge(pedido)
      const segundo = await gateway.createBoletoCharge(pedido)

      /* Dois boletos para uma divida e o cliente pagando duas vezes — e, no
         boleto, sem o estorno instantaneo que o Pix teria. */
      expect(segundo.chargeId).toBe(primeiro.chargeId)
    })

    it('recusa boleto para uma referencia que ja tem Pix', async () => {
      const gateway = criar()
      const pix = await gateway.createPixCharge(pedidoDePix())

      /* Uma divida gera um documento so. Devolver o Pix disfarcado de boleto
         daria uma linha digitavel vazia na tela do lojista. */
      await expect(
        gateway.createBoletoCharge(pedidoDeBoleto({ externalReference: pix.externalReference })),
      ).rejects.toThrow()
    })

    it('tokeniza o cartao e devolve so bandeira e ultimos digitos', async () => {
      const gateway = criar()

      const token = await gateway.tokenizeCard(pedidoDeToken())

      expect(() => cardTokenSchema.parse(token)).not.toThrow()
      expect(token.last4).toBe('1111')
      expect(token.brand).toBe('visa')
      /* O que volta nao pode conter o numero: o retorno vai para tela, log e,
         um dia, backup. */
      expect(JSON.stringify(token)).not.toContain('4111111111111111')
    })

    it('recusa numero de cartao que nao fecha no Luhn', async () => {
      const gateway = criar()

      /* Recusar aqui poupa uma tentativa negada na conta do lojista — e
         negativa demais faz a adquirente olhar a loja com desconfianca. */
      await expect(
        gateway.tokenizeCard(pedidoDeToken({ number: '4111111111111112' })),
      ).rejects.toThrow()
    })

    it('cobra no cartao com o TOTAL, nao com o valor da parcela', async () => {
      const gateway = criar()

      const resultado = await gateway.createCardCharge(pedidoDeCartao())

      expect(() => cardChargeResultSchema.parse(resultado)).not.toThrow()
      if (resultado.status !== 'authorized') throw new Error('esperava autorizada')
      /* 3x de R$ 80,00 sao R$ 240,00 cobrados uma vez — trocar total por
         parcela e o erro classico de integracao de cartao. */
      expect(resultado.charge.amountCents).toBe(24000)
      expect(resultado.charge.installments).toBe(3)
    })

    it('cobrar a mesma referencia no cartao duas vezes nao debita duas vezes', async () => {
      const gateway = criar()
      const pedido = pedidoDeCartao()

      const primeira = await gateway.createCardCharge(pedido)
      const segunda = await gateway.createCardCharge(pedido)

      if (primeira.status !== 'authorized' || segunda.status !== 'authorized') {
        throw new Error('esperava as duas autorizadas')
      }
      /* No cartao a segunda tentativa nao gera um papel a mais: gera um
         segundo debito no limite do cliente. */
      expect(segunda.charge.chargeId).toBe(primeira.charge.chargeId)
    })

    it('cria link de pagamento com URL e vencimento', async () => {
      const gateway = criar()

      const link = await gateway.createPaymentLink(pedidoDeLink())

      expect(() => paymentLinkSchema.parse(link)).not.toThrow()
      expect(link.url).toMatch(/^https:\/\//)
      expect(link.dueDate).toBe('2026-09-10')
    })

    it('recusa estorno de cobranca ainda nao paga, sem lancar', async () => {
      const gateway = criar()
      const cobranca = await gateway.createPixCharge(pedidoDePix())

      const resultado = await gateway.refund({
        companyId: EMPRESA,
        chargeId: cobranca.chargeId,
        reason: 'Cliente desistiu',
        requestedAt: AGORA,
      })

      /* Recusa e resultado, nao excecao: o `catch` de quem chama nao deveria
         poder desfazer a transacao por causa de uma resposta normal. */
      expect(() => refundResultSchema.parse(resultado)).not.toThrow()
      expect(resultado.status).toBe('rejected')
    })

    it('recusa estorno de cobranca inexistente', async () => {
      const gateway = criar()

      const resultado = await gateway.refund({
        companyId: EMPRESA,
        chargeId: 'pay_inexistente',
        reason: 'Tentativa de estorno cego',
        requestedAt: AGORA,
      })

      expect(resultado.status).toBe('rejected')
    })

    it('devolve cotacao de tarifas num dos dois estados validos', async () => {
      const gateway = criar()

      const resultado = await gateway.fetchFeeQuotes({ companyId: EMPRESA, requestedAt: AGORA })

      /* `unavailable` e resposta esperada, nao falha: a cotacao do provedor nao
         tem contrato estavel e nunca pode derrubar venda — RNF-003. */
      expect(() => feeQuoteResultSchema.parse(resultado)).not.toThrow()
      expect(['quoted', 'unavailable']).toContain(resultado.status)
    })

    it('recusa webhook com assinatura invalida, sem parsear o corpo', async () => {
      const gateway = criar()

      const resultado = gateway.readWebhook('{"type":"payment.authorized"}', 'assinatura-forjada')

      expect(() => webhookReadResultSchema.parse(resultado)).not.toThrow()
      /* Nao e 200: responder 200 ensina o atacante que o corpo foi aceito. */
      expect(resultado.status).toBe('invalid_signature')
    })

    it('recusa webhook sem assinatura nenhuma', async () => {
      const gateway = criar()

      expect(gateway.readWebhook('{"type":"payment.authorized"}', '').status).toBe(
        'invalid_signature',
      )
    })
  })
}
