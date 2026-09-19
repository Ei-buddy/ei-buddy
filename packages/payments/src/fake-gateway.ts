import {
  boletoChargeRequestSchema,
  cardChargeRequestSchema,
  cardTokenRequestSchema,
  paymentEventTypeSchema,
  pixChargeRequestSchema,
  paymentLinkRequestSchema,
  refundRequestSchema,
  type BoletoCharge,
  type BoletoChargeRequest,
  type CardBrand,
  type CardCharge,
  type CardChargeRequest,
  type CardChargeResult,
  type CardToken,
  type CardTokenRequest,
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
import { timingSafeEqual } from 'node:crypto'

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
  readonly cartao?: CardCharge
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
  /**
   * Recusa da operadora no cartao. Esta **nao lanca**: "sem limite" e resposta
   * normal, e quem chama tem de saber lidar com ela sem desfazer a venda.
   */
  readonly recusaDeCartao?: { readonly code: string; readonly message: string }
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

  async tokenizeCard(request: CardTokenRequest): Promise<CardToken> {
    this.talvezFalhar()
    const validado = cardTokenRequestSchema.parse(request)

    /*
     * O numero NAO e guardado em lugar nenhum — nem num Map de teste. Um falso
     * que retem o PAN ensina o formato errado de pensar, e um dia alguem copia
     * o desenho dele para o real.
     */
    const token = this.proximoId('tok')
    return {
      token,
      brand: bandeiraPeloPrefixo(validado.number),
      last4: validado.number.slice(-4),
    }
  }

  async createCardCharge(request: CardChargeRequest): Promise<CardChargeResult> {
    this.talvezFalhar()
    const validado = cardChargeRequestSchema.parse(request)

    const recusa = this.opcoes.recusaDeCartao
    if (recusa) return { status: 'declined', decline: { ...recusa } }

    const chave = chaveDeReferencia(validado.companyId, validado.externalReference)
    const existente = this.porReferencia.get(chave)
    if (existente?.cartao) return { status: 'authorized', charge: existente.cartao }

    /* Meio trocado para a mesma divida e erro de quem chama — no cartao, o
       erro seria um segundo debito no limite do cliente. */
    if (existente?.pix || existente?.boleto) {
      throw new Error(
        `A referencia ${validado.externalReference} ja tem cobranca de outro meio. Uma divida gera um documento so.`,
      )
    }

    const chargeId = this.proximoId('pay')
    const cartao: CardCharge = {
      chargeId,
      externalReference: validado.externalReference,
      status: 'authorized',
      amountCents: validado.amountCents,
      installments: validado.installments,
      brand: 'unknown',
      last4: '0000',
    }

    this.guardar(
      {
        companyId: validado.companyId,
        externalReference: validado.externalReference,
        amountCents: validado.amountCents,
        /* Cartao nasce autorizado, ao contrario de Pix e boleto: a operadora
           responde na hora. O dinheiro CAIR e outra coisa, e vem por webhook. */
        status: 'authorized',
        restanteCents: validado.amountCents,
        cartao,
      },
      chargeId,
    )

    return { status: 'authorized', charge: cartao }
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
        cobranca.cartao?.chargeId ??
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
     * Autentica ANTES de parsear — RNF-028. Corpo so vira objeto depois de a
     * requisicao ser reconhecida; o contrario faria o parser rodar sobre
     * entrada de qualquer um.
     */
    if (!this.tokenConfere(signature)) {
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
   * O que o provedor manda no cabecalho de autenticacao.
   *
   * ## Era um HMAC, e isso ensinava a forma errada
   *
   * O Asaas nao assina o corpo: ele repete, em `asaas-access-token`, o mesmo
   * `authToken` que nos cadastramos. Enquanto o falso assinava o corpo, quem
   * escrevesse a rota contra ele calcularia HMAC — e em producao nenhum aviso
   * verdadeiro passaria. E exatamente o tipo de armadilha que este falso
   * existe para reproduzir, e nao para esconder.
   *
   * O parametro `rawBody` sumiu junto: nada aqui depende dele. Mante-lo seria
   * sugerir que o corpo participa da conferencia.
   */
  tokenDeAviso(): string {
    return this.opcoes.webhookSecret ?? SEGREDO_PADRAO
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

  private tokenConfere(recebido: string): boolean {
    const a = Buffer.from(recebido.trim(), 'utf8')
    const b = Buffer.from(this.tokenDeAviso(), 'utf8')
    /* Tempo constante: `===` vaza o tamanho do prefixo correto. O tamanho e
       conferido antes porque `timingSafeEqual` lanca com buffers diferentes, e
       um throw aqui viraria 500 em vez de 401. */
    if (a.length !== b.length || a.length === 0) return false
    return timingSafeEqual(a, b)
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

/**
 * Bandeira pelo primeiro digito — a regra publica de IIN.
 *
 * Existe no falso para a tela ter o que mostrar, nao para valer como
 * identificacao: quem diz a bandeira de verdade e a operadora, na resposta da
 * tokenizacao. O que nao cai nas faixas conhecidas vira `unknown`, e nao um
 * chute.
 */
function bandeiraPeloPrefixo(numero: string): CardBrand {
  /* Elo e Hipercard vem ANTES: as faixas delas comecam com 4 e 6, e testar
     Visa primeiro engoliria todo cartao Elo emitido na faixa 4011. */
  if (/^(4011|4312|4389|5041|6362|6504)/.test(numero)) return 'elo'
  if (/^(606282|3841)/.test(numero)) return 'hipercard'
  if (/^4/.test(numero)) return 'visa'
  if (/^5[1-5]/.test(numero)) return 'mastercard'
  if (/^3[47]/.test(numero)) return 'amex'
  return 'unknown'
}
