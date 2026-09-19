import {
  boletoChargeRequestSchema,
  paymentEventTypeSchema,
  pixChargeRequestSchema,
  paymentLinkRequestSchema,
  refundRequestSchema,
  type BoletoCharge,
  type BoletoChargeRequest,
  type FeeQuote,
  type FeeQuoteResult,
  type PaymentLink,
  type PaymentLinkRequest,
  type PixCharge,
  type PixChargeRequest,
  type RefundRequest,
  type RefundResult,
  type WebhookReadResult,
} from '@na-regua/contracts'
import { Money } from '@na-regua/money'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Gateway falso — `PAYMENTS_PROVIDER=fake`.
 *
 * Responde de forma deterministica, sem rede: permite o sistema subir local sem
 * credencial e nao esperar a DEC-006/DEC-015 para construir venda, cobranca e
 * baixa automatica.
 *
 * **Implementa a mesma porta que o real, inclusive os caminhos de erro** — e
 * aqui isso inclui reproduzir as tres armadilhas documentadas do provedor
 * ([pagmaxx.md](../../../docs/arquitetura/integracoes/pagmaxx.md)), porque
 * falso que nao as reproduz nao protege de nenhuma delas:
 *
 * 1. dinheiro chega decimal (`129.9`) e as vezes string (`"100.00"`);
 * 2. `payment.approved` **nunca** e disparado — quem confirma e
 *    `payment.authorized`;
 * 3. `type` pode vir nulo, e ai o evento e para ignorar.
 */

const SEGREDO_PADRAO = 'segredo-de-webhook-para-teste'

type Cobranca = {
  readonly companyId: string
  readonly externalReference: string
  readonly amountCents: number
  status: PixCharge['status']
  /** Quanto ainda pode ser estornado. */
  restanteCents: number
  readonly pix?: PixCharge
  readonly boleto?: BoletoCharge
  readonly link?: PaymentLink
}

export type FakePaymentGatewayOptions = {
  /** Segredo do HMAC do webhook. O real vem de `PAGMAXX_WEBHOOK_SECRET`. */
  readonly webhookSecret?: string
  /**
   * Tarifas devolvidas por `fetchFeeQuotes`. Ausente = a cotacao responde
   * `unavailable`, que e resposta esperada e nao erro.
   */
  readonly feeQuotes?: readonly FeeQuote[]
  readonly settlementDays?: number
  /**
   * Falha de infraestrutura: credencial invalida, provedor fora do ar. Esta
   * **lanca** — nao e resultado de negocio, e job para retentar.
   */
  readonly falhaDeInfraestrutura?: string
}

export class FakePaymentGateway {
  private readonly porReferencia = new Map<string, Cobranca>()
  private readonly porCobranca = new Map<string, Cobranca>()
  private readonly eventosVistos = new Set<string>()
  private sequencia = 0
  private opcoes: FakePaymentGatewayOptions

  constructor(opcoes: FakePaymentGatewayOptions = {}) {
    this.opcoes = { webhookSecret: SEGREDO_PADRAO, ...opcoes }
  }

  configurar(opcoes: FakePaymentGatewayOptions): void {
    this.opcoes = { ...this.opcoes, ...opcoes }
  }

  async createPixCharge(request: PixChargeRequest): Promise<PixCharge> {
    this.talvezFalhar()
    const validado = pixChargeRequestSchema.parse(request)

    /*
     * Idempotencia por referencia externa. Duas cobrancas para a mesma divida
     * significam cliente pagando duas vezes — e devolver dinheiro custa mais
     * caro que nao cobrar duas.
     */
    const existente = this.porReferencia.get(
      chaveDeReferencia(validado.companyId, validado.externalReference),
    )
    if (existente?.pix) return existente.pix

    const chargeId = this.proximoId('pay')
    const pix: PixCharge = {
      chargeId,
      externalReference: validado.externalReference,
      status: 'pending',
      amountCents: validado.amountCents,
      qrCodePayload: copiaECola(chargeId, validado.amountCents),
      expiresAt: validado.expiresAt ?? null,
    }

    this.guardar(
      {
        companyId: validado.companyId,
        externalReference: validado.externalReference,
        amountCents: validado.amountCents,
        status: 'pending',
        restanteCents: validado.amountCents,
        pix,
      },
      chargeId,
    )

    return pix
  }

  async getPixCharge(request: {
    companyId: string
    chargeId: string
  }): Promise<PixCharge | undefined> {
    this.talvezFalhar()
    const cobranca = this.porCobranca.get(request.chargeId)
    /* Cobranca de outra empresa e o mesmo que inexistente — nunca "proibido". */
    if (!cobranca?.pix || cobranca.companyId !== request.companyId) return undefined
    return { ...cobranca.pix, status: cobranca.status }
  }

  async createBoletoCharge(request: BoletoChargeRequest): Promise<BoletoCharge> {
    this.talvezFalhar()
    const validado = boletoChargeRequestSchema.parse(request)

    const chave = chaveDeReferencia(validado.companyId, validado.externalReference)
    const existente = this.porReferencia.get(chave)
    if (existente?.boleto) return existente.boleto

    /* Meio trocado para a mesma divida e erro de quem chama, e o falso precisa
       reproduzir isso: o real recusa porque a busca por referencia acharia a
       cobranca do outro meio, e um falso permissivo aqui esconderia o bug ate
       producao. */
    if (existente?.pix) {
      throw new Error(
        `A referencia ${validado.externalReference} ja tem cobranca PIX. Uma divida gera um documento so.`,
      )
    }

    const chargeId = this.proximoId('pay')
    const boleto: BoletoCharge = {
      chargeId,
      externalReference: validado.externalReference,
      status: 'pending',
      amountCents: validado.amountCents,
      dueDate: validado.dueDate,
      digitableLine: linhaDigitavel(chargeId, validado.amountCents),
      pdfUrl: `https://fake.payments.local/boleto/${chargeId}.pdf`,
    }

    this.guardar(
      {
        companyId: validado.companyId,
        externalReference: validado.externalReference,
        amountCents: validado.amountCents,
        status: 'pending',
        restanteCents: validado.amountCents,
        boleto,
      },
      chargeId,
    )

    return boleto
  }

  async createPaymentLink(request: PaymentLinkRequest): Promise<PaymentLink> {
    this.talvezFalhar()
    const validado = paymentLinkRequestSchema.parse(request)

    const existente = this.porReferencia.get(
      chaveDeReferencia(validado.companyId, validado.externalReference),
    )
    if (existente?.link) return existente.link

    const linkId = this.proximoId('link')
    const link: PaymentLink = {
      linkId,
      externalReference: validado.externalReference,
      status: 'pending',
      amountCents: validado.amountCents,
      url: `https://fake.payments.local/pay/${linkId}`,
      dueDate: validado.dueDate ?? null,
    }

    this.guardar(
      {
        companyId: validado.companyId,
        externalReference: validado.externalReference,
        amountCents: validado.amountCents,
        status: 'pending',
        restanteCents: validado.amountCents,
        link,
      },
      linkId,
    )

    return link
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    this.talvezFalhar()
    const validado = refundRequestSchema.safeParse(request)
    if (!validado.success) {
      return {
        status: 'rejected',
        rejection: {
          code: 'LOCAL-VALIDACAO',
          message: validado.error.issues[0]?.message ?? 'Pedido de estorno invalido.',
        },
      }
    }

    const cobranca = this.porCobranca.get(validado.data.chargeId)
    if (!cobranca || cobranca.companyId !== validado.data.companyId) {
      return {
        status: 'rejected',
        rejection: { code: 'LOCAL-NAO-ENCONTRADA', message: 'Cobranca nao encontrada.' },
      }
    }

    /* Estornar o que nao foi pago nao e estorno, e confusao contabil. */
    if (cobranca.status !== 'authorized' && cobranca.status !== 'refunded') {
      return {
        status: 'rejected',
        rejection: {
          code: '422',
          message: 'Esta cobranca ainda nao foi paga, entao nao ha o que estornar.',
        },
      }
    }

    const pedido = validado.data.amountCents ?? cobranca.restanteCents
    if (pedido > cobranca.restanteCents) {
      return {
        status: 'rejected',
        rejection: {
          code: '422',
          message: `Valor acima do disponivel para estorno (${Money.fromCents(cobranca.restanteCents).format()}).`,
        },
      }
    }

    cobranca.restanteCents -= pedido
    cobranca.status = cobranca.restanteCents === 0 ? 'refunded' : 'authorized'

    return {
      status: 'refunded',
      refundId: this.proximoId('ref'),
      chargeId:
        cobranca.pix?.chargeId ??
        cobranca.boleto?.chargeId ??
        cobranca.link?.linkId ??
        validado.data.chargeId,
      amountCents: pedido,
      remainingCents: cobranca.restanteCents,
      refundedAt: validado.data.requestedAt,
    }
  }

  async fetchFeeQuotes(request: {
    companyId: string
    requestedAt: string
  }): Promise<FeeQuoteResult> {
    this.talvezFalhar()

    /*
     * `unavailable` e o padrao de proposito. A resposta de cotacao do provedor
     * nao tem contrato estavel, e um falso que sempre cota ensinaria quem chama
     * a confiar num dado que na vida real falta.
     */
    const cotacoes = this.opcoes.feeQuotes
    if (!cotacoes || cotacoes.length === 0) {
      return { status: 'unavailable', reason: 'Cotacao de tarifas indisponivel no provedor.' }
    }

    return {
      status: 'quoted',
      quotes: [...cotacoes],
      ...(this.opcoes.settlementDays === undefined
        ? {}
        : { settlementDays: this.opcoes.settlementDays }),
      quotedAt: request.requestedAt,
    }
  }

  readWebhook(rawBody: string, signature: string): WebhookReadResult {
    /*
     * HMAC sobre o corpo BRUTO, antes de qualquer parse — RNF-028. Se isso
     * rodasse depois de `JSON.parse` + reserializacao, a ordem das chaves e o
     * espacamento mudariam os bytes e nenhuma assinatura legitima passaria.
     */
    if (!this.assinaturaConfere(rawBody, signature)) {
      return { status: 'invalid_signature' }
    }

    let corpo: unknown
    try {
      corpo = JSON.parse(rawBody)
    } catch {
      return { status: 'malformed', reason: 'Corpo do webhook nao e JSON valido.' }
    }

    if (typeof corpo !== 'object' || corpo === null) {
      return { status: 'malformed', reason: 'Corpo do webhook nao e um objeto.' }
    }

    const bruto = corpo as Record<string, unknown>

    /*
     * `type` nulo significa status que o provedor nao mapeou. Ignorar, e nunca
     * adivinhar pelos campos legados `event` e `data`: eles nao tem padrao, e
     * adivinhar ali e como o sistema da baixa na cobranca errada.
     */
    const tipo = paymentEventTypeSchema.safeParse(bruto.type)
    if (!tipo.success) {
      return {
        status: 'ignored',
        reason:
          bruto.type == null
            ? 'Evento sem `type`: status nao mapeado pelo provedor.'
            : `Evento \`${String(bruto.type)}\` nao tratado pelo sistema.`,
      }
    }

    const eventId = typeof bruto.event_id === 'string' ? bruto.event_id : undefined
    if (!eventId) {
      return { status: 'malformed', reason: 'Evento sem identificador para idempotencia.' }
    }

    const pagamento = (bruto.payment ?? bruto.payout) as Record<string, unknown> | undefined
    if (!pagamento || typeof pagamento.id !== 'string') {
      return { status: 'malformed', reason: 'Evento sem `payment.id` para correlacionar.' }
    }

    /*
     * O provedor reentrega o mesmo evento ate 5 vezes. Sem esta guarda, uma
     * baixa vira cinco — e o cliente aparece com credito que nao existe.
     */
    if (this.eventosVistos.has(eventId)) {
      return { status: 'ignored', reason: `Evento ${eventId} ja processado.` }
    }
    this.eventosVistos.add(eventId)

    const cobranca = this.porCobranca.get(pagamento.id)
    if (tipo.data === 'payment.authorized' && cobranca) {
      cobranca.status = 'authorized'
    }
    if (tipo.data === 'payment.failed' && cobranca) {
      cobranca.status = 'failed'
    }

    return {
      status: 'accepted',
      event: {
        eventId,
        type: tipo.data,
        chargeId: pagamento.id,
        externalReference:
          typeof pagamento.external_reference === 'string' ? pagamento.external_reference : null,
        /* Decimal do provedor convertido na BORDA, com Money — armadilha 1. */
        amountCents: centavosDeDecimal(pagamento.amount),
        occurredAt:
          typeof bruto.occurred_at === 'string' ? bruto.occurred_at : new Date(0).toISOString(),
      },
    }
  }

  /* --- Apoio de teste: nao faz parte da porta --- */

  /**
   * Assina um corpo como o provedor assinaria. Existe para o teste montar
   * webhook valido sem duplicar o calculo do HMAC.
   */
  assinar(rawBody: string): string {
    return createHmac('sha256', this.opcoes.webhookSecret ?? SEGREDO_PADRAO)
      .update(rawBody, 'utf8')
      .digest('hex')
  }

  /**
   * Monta o corpo de um webhook do provedor, com `amount` **decimal**, como
   * ele manda de verdade.
   */
  corpoDeWebhook(entrada: {
    eventId: string
    type: string | null
    chargeId: string
    externalReference?: string | null
    /** Decimal, string ou numero — as duas formas acontecem. */
    amount: string | number
    occurredAt: string
  }): string {
    return JSON.stringify({
      event_id: entrada.eventId,
      type: entrada.type,
      occurred_at: entrada.occurredAt,
      /* `event` e `data` sao legados e sem padrao; vao aqui so para o teste
         provar que o adapter NAO os usa. */
      event: 'legado',
      data: { status: 'quem_sabe' },
      payment: {
        id: entrada.chargeId,
        amount: entrada.amount,
        external_reference: entrada.externalReference ?? null,
      },
    })
  }

  private assinaturaConfere(rawBody: string, signature: string): boolean {
    const esperada = Buffer.from(this.assinar(rawBody), 'utf8')
    const recebida = Buffer.from(signature, 'utf8')
    /* Comparacao de tempo constante: `===` vaza o tamanho do prefixo correto. */
    if (esperada.length !== recebida.length) return false
    return timingSafeEqual(esperada, recebida)
  }

  private guardar(cobranca: Cobranca, id: string): void {
    const existente = this.porReferencia.get(
      chaveDeReferencia(cobranca.companyId, cobranca.externalReference),
    )
    const mesclada: Cobranca = existente ? { ...existente, ...cobranca } : cobranca
    this.porReferencia.set(
      chaveDeReferencia(cobranca.companyId, cobranca.externalReference),
      mesclada,
    )
    this.porCobranca.set(id, mesclada)
  }

  private proximoId(prefixo: string): string {
    this.sequencia += 1
    return `${prefixo}_${String(this.sequencia).padStart(6, '0')}`
  }

  private talvezFalhar(): void {
    if (this.opcoes.falhaDeInfraestrutura) {
      throw new Error(this.opcoes.falhaDeInfraestrutura)
    }
  }
}

export function createFakePaymentGateway(opcoes?: FakePaymentGatewayOptions): FakePaymentGateway {
  return new FakePaymentGateway(opcoes)
}

const chaveDeReferencia = (companyId: string, externalReference: string): string =>
  `${companyId}:${externalReference}`

/**
 * Converte o decimal do provedor em centavo inteiro.
 *
 * **Esta e a borda da armadilha 1.** A API devolve `129.9`, `"100.00"` e
 * `100.5` na mesma resposta. `Money.parse` recebe string exatamente para o
 * valor nao passar por ponto flutuante: `129.9 * 100` da `12989.999...`, e
 * arredondar depois so espalha o erro pelo sistema.
 */
export function centavosDeDecimal(valor: unknown): number {
  if (typeof valor !== 'string' && typeof valor !== 'number') return 0
  return Number(Money.parse(String(valor)).cents)
}

/** Copia-e-cola deterministico, no formato de tamanho fixo do EMV do Pix. */
function copiaECola(chargeId: string, amountCents: number): string {
  const valor = Money.fromCents(amountCents).toDecimalString()
  const campo = (id: string, conteudo: string): string =>
    `${id}${String(conteudo.length).padStart(2, '0')}${conteudo}`

  return [
    campo('00', '01'),
    campo('26', `${campo('00', 'br.gov.bcb.pix')}${campo('01', `fake+${chargeId}`)}`),
    campo('52', '0000'),
    campo('53', '986'),
    campo('54', valor),
    campo('58', 'BR'),
    campo('62', campo('05', chargeId)),
  ].join('')
}

/**
 * Linha digitavel deterministica de 47 digitos.
 *
 * Nao e um boleto valido — os digitos verificadores sao arbitrarios, e emitir
 * um documento bancario de mentira que PASSA na conferencia de um banco seria
 * pior que um que nao passa. O que o falso promete e o formato: 47 digitos,
 * estaveis para a mesma cobranca, com o valor no fim, onde ele fica de verdade.
 */
function linhaDigitavel(chargeId: string, amountCents: number): string {
  const digitosDoId = chargeId.replace(/\D/g, '').padStart(10, '0').slice(-10)
  const valor = String(amountCents).padStart(10, '0').slice(-10)
  return `34191${digitosDoId}00000${digitosDoId}0000${valor}`.padEnd(47, '0').slice(0, 47)
}
