import { timingSafeEqual } from 'node:crypto'
import { cardTokenRequestSchema } from '@na-regua/contracts'
import type {
  BoletoCharge,
  BoletoChargeRequest,
  CardBrand,
  CardCharge,
  CardChargeRequest,
  CardChargeResult,
  CardToken,
  CardTokenRequest,
  FeeQuote,
  FeeQuoteResult,
  PaymentLink,
  PaymentLinkRequest,
  PixCharge,
  PixChargeRequest,
  RefundRequest,
  RefundResult,
  WebhookReadResult,
} from '@na-regua/contracts'

/**
 * Gateway de pagamento do lojista no Asaas — NR-044, ADR-0004.
 *
 * Satisfaz `PaymentGateway` (declarada em `core`) estruturalmente: a regra de
 * fronteira proibe `payments` de importar `core`, entao o vocabulario vem de
 * `contracts` — mesmo desenho de `criarEmissorFocusNfe`.
 *
 * ## Chave por loja, nao por plataforma
 *
 * Cada loja tem uma SUBCONTA no Asaas, com chave propria, guardada no cofre.
 * Por isso `credenciais` e uma porta e nao uma string: o adapter resolve a
 * chave por `companyId` a cada chamada. Uma chave global aqui faria toda
 * cobranca cair na conta-pai — o dinheiro do lojista entrando na nossa conta.
 *
 * ## Dinheiro atravessa em centavo; o Asaas fala decimal
 *
 * A conversao acontece **na borda**, aqui, e em nenhum outro lugar. `value:
 * 129.9` no corpo e `amountCents: 12990` no contrato sao o mesmo dinheiro, e
 * deixar o decimal vazar para dentro seria reintroduzir ponto flutuante em
 * valor monetario.
 */

export type CredenciaisAsaas = {
  /** Chave da subconta da loja. `undefined` quando a loja ainda nao tem conta. */
  apiKeyDaEmpresa(companyId: string): Promise<string | undefined>
}

export type AmbienteAsaas = 'sandbox' | 'producao'

export type AsaasOptions = {
  readonly ambiente: AmbienteAsaas
  readonly credenciais: CredenciaisAsaas
  /**
   * O `authToken` que cadastramos no Asaas — RNF-028.
   *
   * Nao e a chave da API, e nao e segredo de HMAC: o Asaas repete este mesmo
   * valor no cabecalho `asaas-access-token` de cada aviso, e conferir e
   * compara-lo.
   *
   * Sem ele o adapter recusa TODO webhook, em vez de aceitar sem conferir.
   * Configuracao faltando nao pode virar porta aberta.
   */
  readonly webhookSecret?: string
  /** Injetavel para teste. Sem isto, o teste falaria com o Asaas de verdade. */
  readonly fetch?: typeof globalThis.fetch
  /** Teto de espera. Cobranca trava o atendimento; nao pode pendurar. */
  readonly timeoutMs?: number
}

const URLS: Record<AmbienteAsaas, string> = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  producao: 'https://api.asaas.com/v3',
}

const TIMEOUT_PADRAO_MS = 15_000

/** Sem conta no Asaas a loja nao cobra — e isso e resposta, nao excecao de rede. */
const SEM_CONTA = 'Esta loja ainda nao tem conta de recebimento configurada.'

export function criarGatewayAsaas(opcoes: AsaasOptions) {
  const buscar = opcoes.fetch ?? globalThis.fetch
  const base = URLS[opcoes.ambiente]
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS

  async function chamar(
    companyId: string,
    caminho: string,
    init: { method: string; body?: unknown } = { method: 'GET' },
  ): Promise<{ ok: boolean; status: number; corpo: Record<string, unknown> }> {
    const apiKey = await opcoes.credenciais.apiKeyDaEmpresa(companyId)
    if (apiKey === undefined) throw new Error(SEM_CONTA)

    /* `AbortSignal.timeout` e nao um setTimeout solto: o segundo deixa a
       requisicao correndo depois de a promessa rejeitar, e em volume isso
       segura conexao que ninguem mais espera. */
    const resposta = await buscar(`${base}${caminho}`, {
      method: init.method,
      headers: {
        access_token: apiKey,
        'content-type': 'application/json',
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    const corpo = (await resposta.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: resposta.ok, status: resposta.status, corpo }
  }

  /**
   * A cobranca ja existente com esta referencia, se houver.
   *
   * E o que torna `createPixCharge` idempotente: o Asaas nao tem chave de
   * idempotencia no POST de cobranca, entao a garantia sai de consultar por
   * `externalReference` antes. Duas cobrancas para uma divida e o cliente
   * pagando duas vezes.
   */
  async function porReferencia(
    companyId: string,
    externalReference: string,
    billingType: 'PIX' | 'BOLETO' | 'CREDIT_CARD',
  ): Promise<Record<string, unknown> | undefined> {
    const { corpo } = await chamar(
      companyId,
      `/payments?externalReference=${encodeURIComponent(externalReference)}`,
    )
    const lista = Array.isArray(corpo.data) ? (corpo.data as Record<string, unknown>[]) : []
    const existente = lista[0]
    if (existente === undefined) return undefined

    /* A busca e so por referencia, entao o meio precisa ser conferido aqui:
       sem isso, pedir boleto para uma venda que ja tem Pix devolveria o Pix
       disfarcado, e a chamada da linha digitavel falharia sem dizer por que.
       Uma divida tem um documento. */
    const tipo = String(existente.billingType ?? '')
    if (tipo !== billingType) {
      throw new Error(
        `A referencia ${externalReference} ja tem cobranca ${tipo} no Asaas. Uma divida gera um documento so.`,
      )
    }

    return existente
  }

  return {
    createPixCharge: async (request: PixChargeRequest): Promise<PixCharge> => {
      const existente = await porReferencia(request.companyId, request.externalReference, 'PIX')

      const pagamento =
        existente ??
        (
          await chamar(request.companyId, '/payments', {
            method: 'POST',
            body: {
              billingType: 'PIX',
              value: centavosParaDecimal(request.amountCents),
              dueDate: (request.expiresAt ?? request.requestedAt).slice(0, 10),
              description: request.description,
              externalReference: request.externalReference,
            },
          })
        ).corpo

      const id = String(pagamento.id ?? '')
      if (id === '') throw new Error('O Asaas nao devolveu id da cobranca.')

      /* O copia-e-cola vem de OUTRA chamada: o POST cria a cobranca, nao o QR.
         Gerar o QR tambem nao e o cliente ter pago. */
      const { corpo: qr } = await chamar(request.companyId, `/payments/${id}/pixQrCode`)

      return {
        chargeId: id,
        externalReference: request.externalReference,
        status: traduzirStatus(String(pagamento.status ?? 'PENDING')),
        amountCents: decimalParaCentavos(pagamento.value),
        qrCodePayload: String(qr.payload ?? ''),
        expiresAt: request.expiresAt ?? null,
      }
    },

    getPixCharge: async (request: {
      companyId: string
      chargeId: string
    }): Promise<PixCharge | undefined> => {
      const { ok, corpo } = await chamar(request.companyId, `/payments/${request.chargeId}`)
      if (!ok) return undefined

      const { corpo: qr } = await chamar(
        request.companyId,
        `/payments/${request.chargeId}/pixQrCode`,
      )

      return {
        chargeId: String(corpo.id ?? request.chargeId),
        externalReference: String(corpo.externalReference ?? ''),
        status: traduzirStatus(String(corpo.status ?? 'PENDING')),
        amountCents: decimalParaCentavos(corpo.value),
        qrCodePayload: String(qr.payload ?? ''),
        expiresAt: null,
      }
    },

    createBoletoCharge: async (request: BoletoChargeRequest): Promise<BoletoCharge> => {
      const existente = await porReferencia(request.companyId, request.externalReference, 'BOLETO')

      const pagamento =
        existente ??
        (
          await chamar(request.companyId, '/payments', {
            method: 'POST',
            body: {
              billingType: 'BOLETO',
              value: centavosParaDecimal(request.amountCents),
              dueDate: request.dueDate,
              description: request.description,
              externalReference: request.externalReference,
            },
          })
        ).corpo

      const id = String(pagamento.id ?? '')
      if (id === '') throw new Error('O Asaas nao devolveu id da cobranca.')

      /* A linha digitavel vem de OUTRA chamada, como o copia-e-cola do Pix: o
         POST cria o titulo, o banco e que numera o documento. */
      const { ok, corpo: ficha } = await chamar(
        request.companyId,
        `/payments/${id}/identificationField`,
      )

      const digitableLine = apenasDigitos(ficha.identificationField)
      if (!ok || digitableLine === '') {
        /* Lanca, e nao devolve pela metade: boleto sem linha digitavel nao e
           pagavel, e entregar um assim faria a tela exibir um campo vazio no
           lugar do unico dado que o cliente precisa digitar. */
        throw new Error('O Asaas nao devolveu a linha digitavel do boleto.')
      }

      return {
        chargeId: id,
        externalReference: request.externalReference,
        status: traduzirStatus(String(pagamento.status ?? 'PENDING')),
        amountCents: decimalParaCentavos(pagamento.value),
        dueDate: String(pagamento.dueDate ?? request.dueDate),
        digitableLine,
        pdfUrl: textoOuNulo(pagamento.bankSlipUrl),
      }
    },

    tokenizeCard: async (request: CardTokenRequest): Promise<CardToken> => {
      /*
       * O unico metodo deste adapter que valida a entrada, e por uma razao que
       * nao vale para os outros: aqui os campos vem de um formulario digitado
       * no balcao, e formulario entrega '4111 1111 1111 1111' e '01310-100'.
       * O schema normaliza para digito puro ANTES de o numero ir para a rede —
       * sem isso, mandariamos o cartao com espacos e o provedor recusaria sem
       * dizer por que. De quebra, o Luhn barra o erro de digitacao antes de
       * ele virar uma tentativa negada na conta do lojista.
       */
      const validado = cardTokenRequestSchema.parse(request)

      const { ok, corpo } = await chamar(validado.companyId, '/creditCard/tokenizeCreditCard', {
        method: 'POST',
        body: {
          customer: validado.customerReference,
          creditCard: {
            holderName: validado.holderName,
            number: validado.number,
            expiryMonth: validado.expiryMonth,
            expiryYear: validado.expiryYear,
            ccv: validado.cvv,
          },
          creditCardHolderInfo: {
            name: validado.holder.name,
            email: validado.holder.email,
            cpfCnpj: validado.holder.document,
            postalCode: validado.holder.postalCode,
            addressNumber: validado.holder.addressNumber,
            phone: validado.holder.phone,
          },
          remoteIp: validado.remoteIp,
        },
      })

      const token = String(corpo.creditCardToken ?? '')
      if (!ok || token === '') {
        /* A mensagem sai do provedor e NAO leva nada do cartao junto: mensagem
           de erro acaba em log, e log e o lugar onde um PAN sobrevive por
           anos sem ninguem notar. */
        throw new Error(
          `O provedor nao tokenizou o cartao: ${String(
            primeiroErro(corpo)?.description ?? 'resposta sem token',
          )}`,
        )
      }

      return {
        token,
        brand: traduzirBandeira(corpo.creditCardBrand),
        last4: apenasDigitos(corpo.creditCardNumber).slice(-4).padStart(4, '0'),
      }
    },

    createCardCharge: async (request: CardChargeRequest): Promise<CardChargeResult> => {
      const existente = await porReferencia(
        request.companyId,
        request.externalReference,
        'CREDIT_CARD',
      )

      /* Idempotencia importa mais no cartao que em qualquer outro meio: aqui a
         segunda tentativa nao gera um segundo boleto que ninguem paga, gera um
         segundo debito no limite do cliente. */
      const resposta = existente
        ? { ok: true, corpo: existente }
        : await chamar(request.companyId, '/payments', {
            method: 'POST',
            body: {
              billingType: 'CREDIT_CARD',
              /* `totalValue` e nao `value`: no parcelado, `value` e o valor da
                 PARCELA. Mandar o total ali cobraria doze vezes a venda. */
              totalValue: centavosParaDecimal(request.amountCents),
              installmentCount: request.installments,
              dueDate: request.dueDate,
              description: request.description,
              externalReference: request.externalReference,
              creditCardToken: request.token,
              remoteIp: request.remoteIp,
            },
          })

      if (!resposta.ok) {
        return {
          status: 'declined',
          decline: {
            code: String(primeiroErro(resposta.corpo)?.code ?? 'card_declined'),
            message: String(
              primeiroErro(resposta.corpo)?.description ?? 'A operadora recusou o cartao.',
            ),
          },
        }
      }

      const pagamento = resposta.corpo
      const id = String(pagamento.id ?? '')
      if (id === '') throw new Error('O Asaas nao devolveu id da cobranca.')

      const cartao = (pagamento.creditCard ?? {}) as Record<string, unknown>
      const cobranca: CardCharge = {
        chargeId: id,
        externalReference: request.externalReference,
        status: traduzirStatus(String(pagamento.status ?? 'PENDING')),
        amountCents: request.amountCents,
        installments: request.installments,
        brand: traduzirBandeira(cartao.creditCardBrand),
        last4: apenasDigitos(cartao.creditCardNumber).slice(-4).padStart(4, '0'),
      }

      return { status: 'authorized', charge: cobranca }
    },

    createPaymentLink: async (request: PaymentLinkRequest): Promise<PaymentLink> => {
      const { corpo } = await chamar(request.companyId, '/paymentLinks', {
        method: 'POST',
        body: {
          name: request.description,
          billingType: 'UNDEFINED',
          chargeType: 'DETACHED',
          value: centavosParaDecimal(request.amountCents),
          externalReference: request.externalReference,
          ...(request.dueDate === undefined
            ? {}
            : { dueDateLimitDays: 1, endDate: request.dueDate }),
        },
      })

      return {
        linkId: String(corpo.id ?? ''),
        externalReference: request.externalReference,
        status: 'pending',
        amountCents: request.amountCents,
        url: String(corpo.url ?? ''),
        dueDate: request.dueDate ?? null,
      }
    },

    refund: async (request: RefundRequest): Promise<RefundResult> => {
      const { ok, corpo } = await chamar(
        request.companyId,
        `/payments/${request.chargeId}/refund`,
        {
          method: 'POST',
          body: {
            ...(request.amountCents === undefined
              ? {}
              : { value: centavosParaDecimal(request.amountCents) }),
            description: request.reason,
          },
        },
      )

      /* Recusa e RESULTADO, nao excecao: "prazo expirado" e "valor acima do
         pago" sao respostas normais do provedor, e quem chama precisa exibir a
         razao — nao capturar um throw. */
      if (!ok) {
        return {
          status: 'rejected',
          rejection: {
            code: String(primeiroErro(corpo)?.code ?? 'refund_rejected'),
            message: String(primeiroErro(corpo)?.description ?? 'O Asaas recusou o estorno.'),
          },
        }
      }

      const valorEstornado = decimalParaCentavos(corpo.value)
      return {
        status: 'refunded',
        refundId: String(corpo.id ?? request.chargeId),
        chargeId: request.chargeId,
        amountCents: request.amountCents ?? valorEstornado,
        remainingCents: Math.max(0, valorEstornado - (request.amountCents ?? valorEstornado)),
        refundedAt: request.requestedAt,
      }
    },

    fetchFeeQuotes: async (request: {
      companyId: string
      requestedAt: string
    }): Promise<FeeQuoteResult> => {
      const { ok, corpo } = await chamar(request.companyId, '/myAccount/fees/')

      /* `unavailable` e resposta esperada, nao falha: a tarifa vem repassada da
         adquirente e nao tem contrato estavel (RNF-003). Quem chama roda
         periodicamente e segue com a tabela que ja tinha. */
      if (!ok) {
        return {
          status: 'unavailable',
          reason: `Asaas respondeu ${String(corpo.status ?? 'erro')}.`,
        }
      }

      const cotacoes = lerCotacoesDeCartao(corpo)
      if (cotacoes.length === 0) {
        return { status: 'unavailable', reason: 'O Asaas nao devolveu tarifa de cartao.' }
      }

      return { status: 'quoted', quotes: cotacoes, quotedAt: request.requestedAt }
    },

    readWebhook: (rawBody: string, signature: string): WebhookReadResult => {
      /* Segredo ausente recusa TUDO. Aceitar sem conferir seria transformar
         configuracao faltando em porta aberta — qualquer um postaria
         "pagamento autorizado" e o titulo baixaria sozinho. */
      if (opcoes.webhookSecret === undefined) return { status: 'invalid_signature' }
      if (!tokenConfere(signature, opcoes.webhookSecret)) {
        return { status: 'invalid_signature' }
      }

      let corpo: Record<string, unknown>
      try {
        corpo = JSON.parse(rawBody) as Record<string, unknown>
      } catch {
        return { status: 'malformed', reason: 'Corpo do webhook nao e JSON.' }
      }

      const tipo = TIPOS_DE_EVENTO[String(corpo.event ?? '')]
      if (tipo === undefined) {
        return { status: 'ignored', reason: `Evento ${String(corpo.event ?? '?')} nao interessa.` }
      }

      const pagamento = (corpo.payment ?? {}) as Record<string, unknown>
      const chargeId = String(pagamento.id ?? '')
      if (chargeId === '') {
        return { status: 'malformed', reason: 'Webhook sem id de cobranca.' }
      }

      return {
        status: 'accepted',
        event: {
          eventId: String(corpo.id ?? chargeId),
          type: tipo,
          chargeId,
          externalReference:
            pagamento.externalReference === undefined || pagamento.externalReference === null
              ? null
              : String(pagamento.externalReference),
          amountCents: decimalParaCentavos(pagamento.value),
          occurredAt: String(corpo.dateCreated ?? new Date().toISOString()),
        },
      }
    },
  }
}

/**
 * O decimal do provedor vira centavo inteiro.
 *
 * `Math.round` e nao `Math.trunc`: `129.9 * 100` da `12989.999...` em ponto
 * flutuante, e truncar cobraria um centavo a menos do lojista em toda venda
 * terminada em 9.
 */
function decimalParaCentavos(valor: unknown): number {
  const numero = typeof valor === 'number' ? valor : Number(valor ?? 0)
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0
}

/**
 * So os digitos — a linha digitavel atravessa a porta em forma canonica.
 *
 * O Asaas devolve `34191.09008 61713.957308 …`, e pontos e espacos sao
 * apresentacao. Quem mostra reinsere a pontuacao; quem compara ou grava quer
 * os 47 digitos. Mesmo criterio do dinheiro em centavo.
 */
function apenasDigitos(valor: unknown): string {
  return typeof valor === 'string' ? valor.replace(/\D/g, '') : ''
}

/** String nao vazia do provedor, ou `null`. Campo ausente nao vira `"undefined"`. */
function textoOuNulo(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null
}

function centavosParaDecimal(centavos: number): number {
  return centavos / 100
}

/** Estados do Asaas para os nossos. O que nao reconhecemos fica `pending`. */
const ESTADOS: Record<string, PixCharge['status']> = {
  PENDING: 'pending',
  AWAITING_RISK_ANALYSIS: 'pending',
  CONFIRMED: 'authorized',
  RECEIVED: 'authorized',
  RECEIVED_IN_CASH: 'authorized',
  REFUNDED: 'refunded',
  REFUND_REQUESTED: 'refunded',
  OVERDUE: 'expired',
  CHARGEBACK_REQUESTED: 'failed',
  CHARGEBACK_DISPUTE: 'failed',
}

/**
 * Bandeira do provedor para a nossa.
 *
 * O que nao reconhecemos vira `unknown`, e nao um chute: a bandeira aparece na
 * tela como "Visa final 4321", e escrever a errada faz o lojista procurar um
 * cartao que o cliente nao usou.
 */
const BANDEIRAS: Record<string, CardBrand> = {
  VISA: 'visa',
  MASTERCARD: 'mastercard',
  ELO: 'elo',
  AMEX: 'amex',
  DINERS: 'unknown',
  DISCOVER: 'unknown',
  HIPERCARD: 'hipercard',
}

function traduzirBandeira(bruto: unknown): CardBrand {
  return typeof bruto === 'string' ? (BANDEIRAS[bruto.toUpperCase()] ?? 'unknown') : 'unknown'
}

function traduzirStatus(bruto: string): PixCharge['status'] {
  return ESTADOS[bruto] ?? 'pending'
}

const TIPOS_DE_EVENTO: Record<
  string,
  'payment.authorized' | 'payment.refunded' | 'payment.failed'
> = {
  PAYMENT_CONFIRMED: 'payment.authorized',
  PAYMENT_RECEIVED: 'payment.authorized',
  PAYMENT_REFUNDED: 'payment.refunded',
  PAYMENT_CHARGEBACK_REQUESTED: 'payment.failed',
}

function primeiroErro(corpo: Record<string, unknown>): Record<string, unknown> | undefined {
  const erros = Array.isArray(corpo.errors) ? (corpo.errors as Record<string, unknown>[]) : []
  return erros[0]
}

/**
 * O Asaas autentica webhook com TOKEN ESTATICO, e nao com HMAC — RNF-028.
 *
 * ## O defeito que isto corrige
 *
 * A primeira versao calculava `HMAC-SHA256` sobre o corpo e comparava com o
 * cabecalho. O Asaas nao assina corpo nenhum: ele manda, em
 * `asaas-access-token`, o mesmo `authToken` que NOS cadastramos ao criar o
 * webhook (32–255 caracteres) — e nao e a chave da API
 * ([asaas.md](../../../docs/arquitetura/integracoes/asaas.md)).
 *
 * Nenhum aviso verdadeiro passaria: todos responderiam 401 e nenhuma cobranca
 * daria baixa. Pior, o sintoma seria silencioso — o lojista veria "aguardando
 * pagamento" para um Pix que o cliente ja pagou.
 *
 * ## Continua sendo tempo constante
 *
 * `===` vazaria, pelo tempo de resposta, quanto do prefixo bateu — e com isso
 * se descobre o token caractere a caractere. A comparacao de tamanho antes e
 * necessaria porque `timingSafeEqual` LANCA com buffers de tamanhos
 * diferentes, e um throw aqui seria 500 em vez de 401.
 */
function tokenConfere(recebido: string, esperado: string): boolean {
  /* `trim` no recebido, e nao no esperado: o cabecalho pode chegar com espaco
     de um proxy no caminho; o segredo configurado nao tem espaco por regra do
     proprio Asaas. */
  const a = Buffer.from(recebido.trim(), 'utf8')
  const b = Buffer.from(esperado, 'utf8')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

/**
 * Tarifa de cartao, do que o Asaas devolver.
 *
 * `brand: 'unknown'` de proposito, e nao uma bandeira escolhida: a tarifa do
 * Asaas e da CONTA, nao por bandeira — ele cobra o mesmo para Visa e Elo.
 * Repetir a mesma taxa sob cinco bandeiras daria a impressao de cinco medidas
 * independentes; `unknown` diz o que a cotacao realmente e.
 */
function lerCotacoesDeCartao(corpo: Record<string, unknown>): FeeQuote[] {
  const cartao = (corpo.creditCard ?? {}) as Record<string, unknown>
  const aVista = Number(cartao.operationValue ?? cartao.oneInstallmentPercentage ?? NaN)
  const parcelado = Number(cartao.upToSixInstallmentsPercentage ?? NaN)

  const cotacoes: FeeQuote[] = []
  if (Number.isFinite(aVista)) {
    cotacoes.push({ brand: 'unknown', installments: 1, feeRatePercent: aVista })
  }
  if (Number.isFinite(parcelado)) {
    cotacoes.push({ brand: 'unknown', installments: 6, feeRatePercent: parcelado })
  }

  return cotacoes
}
