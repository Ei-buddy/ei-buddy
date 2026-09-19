import { z } from 'zod'
import {
  dateSchema,
  dateTimeSchema,
  idSchema,
  moneyCentsSchema,
  rateSchema,
} from '../common/primitives.js'
import { cardBrandSchema } from '../sale/sale.js'

/**
 * Gateway de pagamento — o dinheiro do LOJISTA. RF-034, RF-063, RF-067, RF-068.
 *
 * Contrato entre `core` e o adapter `payments`, pelo mesmo motivo estrutural da
 * nota fiscal: `adapter-nao-importa-core` proibe `payments` de conhecer `core`,
 * entao o vocabulario comum tem de morar em `contracts`.
 *
 * **Dinheiro aqui e centavo inteiro, sempre.** A API do provedor devolve
 * decimal — `129.9`, e as vezes a string `"100.00"`, na mesma resposta
 * ([pagmaxx.md](../../../../docs/arquitetura/integracoes/pagmaxx.md)). A
 * conversao acontece na BORDA do adapter, com `Money.parse`, e nunca com
 * `parseFloat` seguido de aritmetica. Deste lado da porta o problema nao
 * existe mais.
 */

/** Estado de uma cobranca. `authorized` e o unico que libera baixa. */
export const chargeStatusSchema = z.enum(
  ['pending', 'authorized', 'refunded', 'expired', 'cancelled', 'failed'],
  { error: 'Estado de cobranca invalido.' },
)
export type ChargeStatus = z.infer<typeof chargeStatusSchema>

/** Valor cobravel: centavo inteiro e maior que zero. Cobranca de zero nao existe. */
const chargeableAmountSchema = moneyCentsSchema.refine((v) => v > 0, {
  message: 'O valor da cobranca precisa ser maior que zero.',
})

/**
 * Quem paga. Opcional: cobranca de balcao sai sem identificar ninguem.
 */
export const payerSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome muito curto.').max(120, 'Nome muito longo.').optional(),
    document: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((d) => d.length === 11 || d.length === 14, {
        message: 'Documento invalido. Informe CPF ou CNPJ.',
      })
      .optional(),
  })
  .strict()

export type Payer = z.infer<typeof payerSchema>

/**
 * `externalReference` e o nosso identificador da coisa cobrada — a venda ou o
 * recebivel.
 *
 * Existe porque a regra de correlacao do provedor e explicita: **nunca
 * correlacionar por nome, valor ou horario.** Duas vendas de R$ 50,00 no mesmo
 * minuto sao indistinguiveis por valor, e dar baixa na errada e pior que nao
 * dar baixa. Serve tambem de chave de idempotencia: pedir a mesma cobranca duas
 * vezes devolve a mesma.
 */
const externalReferenceSchema = idSchema

export const pixChargeRequestSchema = z
  .object({
    companyId: idSchema,
    externalReference: externalReferenceSchema,
    amountCents: chargeableAmountSchema,
    /** Vai na tela do cliente no aplicativo do banco. */
    description: z.string().trim().min(1, 'Descricao obrigatoria.').max(140, 'Descricao longa.'),
    /** Ausente = o provedor decide o prazo. */
    expiresAt: dateTimeSchema.optional(),
    payer: payerSchema.optional(),
    requestedAt: dateTimeSchema,
  })
  .strict()

export type PixChargeRequest = z.infer<typeof pixChargeRequestSchema>

export const pixChargeSchema = z
  .object({
    /** `payment.id` do provedor — o que o webhook usa para correlacionar. */
    chargeId: idSchema,
    externalReference: externalReferenceSchema,
    status: chargeStatusSchema,
    amountCents: chargeableAmountSchema,
    /** Copia-e-cola do Pix. E o que o cliente cola no banco. */
    qrCodePayload: z.string().min(1, 'Cobranca Pix sem copia-e-cola nao serve.'),
    expiresAt: dateTimeSchema.nullable(),
  })
  .strict()

export type PixCharge = z.infer<typeof pixChargeSchema>

/**
 * Boleto — RF-034.
 *
 * `dueDate` e **obrigatorio** aqui, e opcional no Pix, porque sao dois
 * documentos diferentes: o Pix pode nascer sem prazo e o provedor decide; o
 * boleto E um titulo com vencimento impresso nele. Boleto sem vencimento nao
 * existe no banco que vai recebe-lo.
 */
export const boletoChargeRequestSchema = z
  .object({
    companyId: idSchema,
    externalReference: externalReferenceSchema,
    amountCents: chargeableAmountSchema,
    /** Sai impresso no boleto, no campo de demonstrativo. */
    description: z.string().trim().min(1, 'Descricao obrigatoria.').max(140, 'Descricao longa.'),
    dueDate: dateSchema,
    payer: payerSchema.optional(),
    requestedAt: dateTimeSchema,
  })
  .strict()

export type BoletoChargeRequest = z.infer<typeof boletoChargeRequestSchema>

/**
 * A linha digitavel, em **digito puro**.
 *
 * O provedor devolve formatado — `34191.09008 61713.957308 …` —, e os pontos e
 * espacos sao apresentacao, nao dado: quem confere, compara ou grava precisa
 * dos 47 digitos, e quem MOSTRA reinsere a pontuacao. Mesmo criterio de
 * dinheiro em centavo: a forma canonica atravessa a porta, a formatacao fica
 * na tela.
 *
 * Sao 47 porque e boleto de cobranca bancaria, o unico que uma loja emite para
 * uma venda. Os 48 digitos sao de arrecadacao (agua, luz, tributo) — outro
 * documento, que nao sai daqui.
 */
const digitableLineSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((d) => d.length === 47, {
    message: 'Linha digitavel invalida. Um boleto de cobranca tem 47 digitos.',
  })

export const boletoChargeSchema = z
  .object({
    chargeId: idSchema,
    externalReference: externalReferenceSchema,
    status: chargeStatusSchema,
    amountCents: chargeableAmountSchema,
    dueDate: dateSchema,
    /**
     * Obrigatoria, pelo mesmo motivo do copia-e-cola no Pix: boleto sem linha
     * digitavel nao e pagavel, e devolver um pela metade faria a tela mostrar
     * um campo vazio no lugar do unico dado que o cliente precisa digitar.
     */
    digitableLine: digitableLineSchema,
    /** PDF do boleto, para imprimir ou anexar. Nem sempre o provedor devolve. */
    pdfUrl: z.string().url('URL do boleto invalida.').nullable(),
  })
  .strict()

export type BoletoCharge = z.infer<typeof boletoChargeSchema>

export const paymentLinkRequestSchema = z
  .object({
    companyId: idSchema,
    externalReference: externalReferenceSchema,
    amountCents: chargeableAmountSchema,
    description: z.string().trim().min(1, 'Descricao obrigatoria.').max(140, 'Descricao longa.'),
    /** Vencimento da divida, que a mensagem de cobranca mostra — RF-068. */
    dueDate: dateSchema.optional(),
    payer: payerSchema.optional(),
    requestedAt: dateTimeSchema,
  })
  .strict()

export type PaymentLinkRequest = z.infer<typeof paymentLinkRequestSchema>

export const paymentLinkSchema = z
  .object({
    linkId: idSchema,
    externalReference: externalReferenceSchema,
    status: chargeStatusSchema,
    amountCents: chargeableAmountSchema,
    /** A URL que vai na mensagem de cobranca. */
    url: z.string().url('Link de pagamento invalido.'),
    dueDate: dateSchema.nullable(),
  })
  .strict()

export type PaymentLink = z.infer<typeof paymentLinkSchema>

/** Estorno — RF-067. Ausencia de `amountCents` significa estorno total. */
export const refundRequestSchema = z
  .object({
    companyId: idSchema,
    /** `chargeId` da cobranca ja autorizada. */
    chargeId: idSchema,
    amountCents: chargeableAmountSchema.optional(),
    reason: z.string().trim().min(1, 'Motivo obrigatorio.').max(280, 'Motivo muito longo.'),
    requestedAt: dateTimeSchema,
  })
  .strict()

export type RefundRequest = z.infer<typeof refundRequestSchema>

/**
 * Resultado do estorno.
 *
 * Uniao discriminada pela mesma razao da nota fiscal: estorno recusado e
 * RESULTADO, nao excecao. "Prazo expirado" e "valor acima do pago" sao
 * respostas normais do provedor, e o `catch` mais proximo nao deveria poder
 * desfazer a transacao de quem pediu.
 */
export const refundResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('refunded'),
      refundId: idSchema,
      chargeId: idSchema,
      amountCents: chargeableAmountSchema,
      /** Estorno parcial deixa saldo; total zera. */
      remainingCents: moneyCentsSchema,
      refundedAt: dateTimeSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      rejection: z.object({ code: z.string().min(1), message: z.string().min(1) }).strict(),
    })
    .strict(),
])

export type RefundResult = z.infer<typeof refundResultSchema>

/**
 * Cotacao de tarifa de cartao.
 *
 * **Nao e a `CardFeeTable` de `domain`**, e a diferenca e obrigatoria, nao
 * estetica: `adapter-nao-importa-core` proibe `payments` de importar `domain`,
 * entao o adapter nao tem como devolver aquele tipo. Ele devolve cotacao crua e
 * `core` traduz — que e tambem onde a decisao de confiar ou nao na cotacao
 * pertence.
 */
export const feeQuoteSchema = z
  .object({
    brand: cardBrandSchema,
    installments: z.number().int().min(1, 'Parcela minima e 1.').max(21, 'Maximo de 21 parcelas.'),
    /** Pontos por cem: 3.49 = 3,49%. Mesma unidade de `CardFeeRate`. */
    feeRatePercent: rateSchema,
  })
  .strict()

export type FeeQuote = z.infer<typeof feeQuoteSchema>

/**
 * Resultado da cotacao.
 *
 * `unavailable` existe porque a resposta de cotacao do provedor **nao tem
 * contrato estavel** — ela e repassada da adquirente. Por isso a cotacao nunca
 * e chamada no fechamento da venda: ela alimenta a tabela periodicamente, e
 * falhar em alimentar nao pode derrubar venda nenhuma (RNF-003, RNF-041).
 */
export const feeQuoteResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('quoted'),
      quotes: z.array(feeQuoteSchema).min(1, 'Cotacao vazia nao e cotacao.'),
      /** Dias ate o primeiro repasse, se o provedor informar. */
      settlementDays: z.number().int().positive().optional(),
      quotedAt: dateTimeSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('unavailable'),
      reason: z.string().min(1),
    })
    .strict(),
])

export type FeeQuoteResult = z.infer<typeof feeQuoteResultSchema>

/**
 * Evento de pagamento vindo do webhook.
 *
 * Somente os tipos que o sistema sabe tratar. Em particular **nao existe
 * `payment.approved`**: o provedor nunca o dispara, e quem confirma pagamento e
 * `payment.authorized`. Esperar `approved` e o bug de ficar esperando para
 * sempre uma baixa que nunca vem.
 */
export const paymentEventTypeSchema = z.enum([
  'payment.authorized',
  'payment.refunded',
  'payment.failed',
  'payout.paid',
])
export type PaymentEventType = z.infer<typeof paymentEventTypeSchema>

export const paymentEventSchema = z
  .object({
    /**
     * `X-Pagmaxx-Event-Id`. O provedor reentrega o mesmo evento ate 5 vezes:
     * sem este id, uma baixa vira cinco.
     */
    eventId: idSchema,
    type: paymentEventTypeSchema,
    chargeId: idSchema,
    /** Pode faltar em evento de repasse, que nao aponta para uma venda. */
    externalReference: externalReferenceSchema.nullable(),
    amountCents: moneyCentsSchema,
    occurredAt: dateTimeSchema,
  })
  .strict()

export type PaymentEvent = z.infer<typeof paymentEventSchema>

/**
 * Resultado da leitura de um webhook.
 *
 * Quatro casos, e a diferenca entre eles decide o **codigo HTTP da resposta**,
 * que e a parte que gera bug quando se resume tudo a "deu erro":
 *
 * | Caso                | Resposta      | Por que                                                     |
 * | ------------------- | ------------- | ----------------------------------------------------------- |
 * | `accepted`          | 200, na fila  | processa fora do ciclo da requisicao                        |
 * | `ignored`           | 200           | evento que nao nos interessa; 4xx faria o provedor reentregar |
 * | `invalid_signature` | 401           | **nao** e 200: 200 ensina o atacante que o corpo foi aceito |
 * | `malformed`         | 400           | assinatura valida, corpo ilegivel — isso e bug do provedor  |
 */
export const webhookReadResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('accepted'), event: paymentEventSchema }).strict(),
  z.object({ status: z.literal('ignored'), reason: z.string().min(1) }).strict(),
  z.object({ status: z.literal('invalid_signature') }).strict(),
  z.object({ status: z.literal('malformed'), reason: z.string().min(1) }).strict(),
])

export type WebhookReadResult = z.infer<typeof webhookReadResultSchema>
