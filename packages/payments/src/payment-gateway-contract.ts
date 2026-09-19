import {
  boletoChargeSchema,
  feeQuoteResultSchema,
  paymentLinkSchema,
  pixChargeSchema,
  refundResultSchema,
  webhookReadResultSchema,
  type BoletoCharge,
  type BoletoChargeRequest,
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
