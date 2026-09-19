import {
  createSubscriptionRequestSchema,
  type CreateSubscriptionRequest,
  type ProviderSubscription,
  type SubscriptionEventType,
  type SubscriptionWebhookResult,
} from '@na-regua/contracts'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Provedor de assinatura falso — a NOSSA mensalidade, sem rede.
 *
 * Permite construir trial, cobranca, aviso e bloqueio (RF-110 a RF-118) antes
 * de existir conta-pai configurada. Implementa a mesma porta que o real,
 * inclusive os caminhos de erro — e **reproduz as armadilhas do provedor**,
 * porque um falso que nao as reproduz nao protege de nenhuma delas:
 *
 * 1. dinheiro chega decimal (`129.9`) e as vezes string (`"100.00"`);
 * 2. o mesmo evento e reentregue — quem nao guarda `eventId` ativa duas vezes;
 * 3. evento sem `externalReference` acontece, e nao da para adivinhar de quem e.
 */

const SEGREDO_PADRAO = 'segredo-de-assinatura-para-teste'

type Recorrencia = {
  readonly companyId: string
  readonly externalReference: string
  readonly providerSubscriptionId: string
  readonly amountCents: number
  providerStatus: string
  nextDueDate: string
}

export type FakeSubscriptionProviderOptions = {
  readonly webhookSecret?: string
  /**
   * Falha de infraestrutura: credencial invalida, provedor fora do ar. Esta
   * **lanca** — nao e resultado de negocio, e job para retentar.
   */
  readonly falhaDeInfraestrutura?: string
}

export class FakeSubscriptionProvider {
  private readonly porReferencia = new Map<string, Recorrencia>()
  private readonly porProvedor = new Map<string, Recorrencia>()
  private sequencia = 0
  private opcoes: FakeSubscriptionProviderOptions

  constructor(opcoes: FakeSubscriptionProviderOptions = {}) {
    this.opcoes = { webhookSecret: SEGREDO_PADRAO, ...opcoes }
  }

  configurar(opcoes: FakeSubscriptionProviderOptions): void {
    this.opcoes = { ...this.opcoes, ...opcoes }
  }

  async createSubscription(request: CreateSubscriptionRequest): Promise<ProviderSubscription> {
    this.talvezFalhar()
    const validado = createSubscriptionRequestSchema.parse(request)

    /*
     * Idempotencia por referencia externa. Duas recorrencias para um lojista
     * sao ele pagando em dobro todo mes — e descobrindo no extrato, nao aqui.
     */
    const existente = this.porReferencia.get(validado.externalReference)
    if (existente) return paraContrato(existente)

    this.sequencia += 1
    const recorrencia: Recorrencia = {
      companyId: validado.companyId,
      externalReference: validado.externalReference,
      providerSubscriptionId: `sub_${String(this.sequencia).padStart(6, '0')}`,
      amountCents: validado.amountCents,
      /* Nasce PENDENTE. Criar a recorrencia nao e o lojista ter pago: quem
         ativa o acesso e o evento `subscription.paid`. */
      providerStatus: 'PENDING',
      nextDueDate: validado.firstDueDate,
    }

    this.porReferencia.set(recorrencia.externalReference, recorrencia)
    this.porProvedor.set(recorrencia.providerSubscriptionId, recorrencia)

    return paraContrato(recorrencia)
  }

  async cancelSubscription(request: {
    companyId: string
    providerSubscriptionId: string
    reason: string
    requestedAt: string
  }): Promise<void> {
    this.talvezFalhar()

    const recorrencia = this.porProvedor.get(request.providerSubscriptionId)
    /* Cancelar o que nao existe (ou o que e de outra empresa) e sucesso, e nao
       erro: o contrario prenderia o lojista a uma cobranca porque um
       cancelamento anterior falhou pela metade. */
    if (!recorrencia || recorrencia.companyId !== request.companyId) return

    recorrencia.providerStatus = 'CANCELLED'
  }

  readWebhook(rawBody: string, signature: string): SubscriptionWebhookResult {
    /* HMAC sobre o corpo BRUTO, antes de qualquer parse — RNF-028. Depois de
       `JSON.parse` + reserializacao, a ordem das chaves e o espacamento mudam
       os bytes e nenhuma assinatura legitima passaria. */
    if (!this.assinaturaConfere(rawBody, signature)) return { status: 'invalid_signature' }

    let corpo: Record<string, unknown>
    try {
      corpo = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return { status: 'malformed', reason: 'Corpo do webhook nao e JSON.' }
    }

    const tipo = TIPOS[String(corpo.event ?? '')]
    if (tipo === undefined) {
      return { status: 'ignored', reason: `Evento ${String(corpo.event ?? '?')} nao interessa.` }
    }

    const assinatura = (corpo.subscription ?? {}) as Record<string, unknown>
    const providerSubscriptionId = String(assinatura.id ?? '')
    if (providerSubscriptionId === '') {
      return { status: 'malformed', reason: 'Webhook sem id de assinatura.' }
    }

    return {
      status: 'accepted',
      event: {
        eventId: String(corpo.id ?? providerSubscriptionId),
        type: tipo,
        providerSubscriptionId,
        externalReference:
          assinatura.externalReference === undefined || assinatura.externalReference === null
            ? null
            : String(assinatura.externalReference),
        amountCents: centavosDeDecimal(assinatura.value),
        failureReason:
          corpo.failureReason === undefined || corpo.failureReason === null
            ? null
            : String(corpo.failureReason),
        occurredAt: String(corpo.dateCreated ?? new Date().toISOString()),
      },
    }
  }

  /** Assina um corpo como o provedor assinaria — para o teste nao duplicar o HMAC. */
  assinar(rawBody: string): string {
    return createHmac('sha256', this.opcoes.webhookSecret ?? SEGREDO_PADRAO)
      .update(rawBody, 'utf8')
      .digest('hex')
  }

  /** Monta um corpo de webhook com `value` DECIMAL, como ele chega de verdade. */
  corpoDeWebhook(entrada: {
    eventId: string
    event: string
    providerSubscriptionId: string
    externalReference?: string | null
    /** Decimal ou string — as duas formas acontecem na mesma API. */
    value: string | number
    failureReason?: string | null
    occurredAt: string
  }): string {
    return JSON.stringify({
      id: entrada.eventId,
      event: entrada.event,
      dateCreated: entrada.occurredAt,
      failureReason: entrada.failureReason ?? null,
      subscription: {
        id: entrada.providerSubscriptionId,
        value: entrada.value,
        externalReference: entrada.externalReference ?? null,
      },
    })
  }

  private assinaturaConfere(rawBody: string, signature: string): boolean {
    const esperada = Buffer.from(this.assinar(rawBody), 'utf8')
    const recebida = Buffer.from(signature, 'utf8')
    /* Tempo constante: `===` vaza, pelo tempo de resposta, o tamanho do
       prefixo correto — e com isso se descobre a assinatura byte a byte. */
    if (esperada.length !== recebida.length) return false
    return timingSafeEqual(esperada, recebida)
  }

  private talvezFalhar(): void {
    if (this.opcoes.falhaDeInfraestrutura) throw new Error(this.opcoes.falhaDeInfraestrutura)
  }
}

export function createFakeSubscriptionProvider(
  opcoes?: FakeSubscriptionProviderOptions,
): FakeSubscriptionProvider {
  return new FakeSubscriptionProvider(opcoes)
}

const TIPOS: Record<string, SubscriptionEventType> = {
  PAYMENT_CONFIRMED: 'subscription.paid',
  PAYMENT_RECEIVED: 'subscription.paid',
  PAYMENT_OVERDUE: 'subscription.payment_failed',
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'subscription.payment_failed',
  SUBSCRIPTION_DELETED: 'subscription.cancelled',
}

const paraContrato = (r: Recorrencia): ProviderSubscription => ({
  providerSubscriptionId: r.providerSubscriptionId,
  externalReference: r.externalReference,
  providerStatus: r.providerStatus,
  nextDueDate: r.nextDueDate,
})

/**
 * O decimal do provedor em centavo inteiro.
 *
 * `Math.round` e nao `Math.trunc`: `129.9 * 100` da `12989.999...` em ponto
 * flutuante, e truncar cobraria um centavo a menos todo mes.
 */
export function centavosDeDecimal(valor: unknown): number {
  if (typeof valor !== 'string' && typeof valor !== 'number') return 0
  const numero = Number(valor)
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0
}
