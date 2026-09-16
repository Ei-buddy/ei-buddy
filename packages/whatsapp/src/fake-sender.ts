import {
  inboundMessageSchema,
  sendMediaRequestSchema,
  sendTextRequestSchema,
  whatsappNumberSchema,
  type InboundReadResult,
  type SendMediaRequest,
  type SendRejectionReason,
  type SendResult,
  type SendTextRequest,
} from '@na-regua/contracts'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Remetente falso — `WHATSAPP_PROVIDER=fake`.
 *
 * Responde de forma deterministica, sem rede: o sistema sobe local sem
 * credencial. Chip de verdade e `WHATSAPP_PROVIDER=meta` (ADR-0014, NR-046).
 *
 * **Implementa a mesma porta que o real, inclusive os caminhos de erro** — e no
 * WhatsApp os caminhos de erro sao a parte que mais gera bug, porque nenhum
 * deles e falha de infraestrutura: numero sem WhatsApp, cliente que bloqueou a
 * loja, e sobretudo a **janela de atendimento de 24 horas**, que e a regra que
 * mais surpreende quem nunca integrou o provedor.
 */

const SEGREDO_PADRAO = 'segredo-de-webhook-para-teste'
const JANELA_DE_ATENDIMENTO_MS = 24 * 60 * 60 * 1000

/** Mensagem que o falso "entregou", para o teste conferir. */
export type MensagemEnviada = {
  readonly messageId: string
  readonly companyId: string
  readonly to: string
  readonly body: string
  readonly sentAt: string
}

export type FakeMessageSenderOptions = {
  readonly webhookSecret?: string
  /** Numeros que o provedor recusa, e com qual motivo. */
  readonly recusas?: Readonly<Record<string, SendRejectionReason>>
  /** Envios permitidos por empresa antes de `rate_limited`. */
  readonly limitePorEmpresa?: number
  /**
   * Falha de infraestrutura: token invalido, provedor fora do ar. **Lanca** —
   * nao e recusa de destinatario, e job para retentar.
   */
  readonly falhaDeInfraestrutura?: string
}

export class FakeMessageSender {
  /** Resultado por chave de idempotencia. */
  private readonly porChave = new Map<string, SendResult>()
  /** Ultima mensagem recebida por numero de cliente — base da janela de 24h. */
  private readonly ultimaEntrada = new Map<string, number>()
  private readonly enviadas: MensagemEnviada[] = []
  private readonly entradasVistas = new Set<string>()
  private readonly enviosPorEmpresa = new Map<string, number>()
  private sequencia = 0
  private opcoes: FakeMessageSenderOptions

  constructor(opcoes: FakeMessageSenderOptions = {}) {
    this.opcoes = { webhookSecret: SEGREDO_PADRAO, ...opcoes }
  }

  configurar(opcoes: FakeMessageSenderOptions): void {
    this.opcoes = { ...this.opcoes, ...opcoes }
  }

  /** O que o falso entregou, em ordem. Apoio de teste. */
  get entregues(): readonly MensagemEnviada[] {
    return [...this.enviadas]
  }

  async sendText(request: SendTextRequest): Promise<SendResult> {
    this.talvezFalhar()
    const validado = sendTextRequestSchema.parse(request)
    return this.entregar(validado, validado.body)
  }

  async sendMedia(request: SendMediaRequest): Promise<SendResult> {
    this.talvezFalhar()
    const validado = sendMediaRequestSchema.parse(request)
    const rotulo = validado.filename ?? validado.kind
    return this.entregar(validado, validado.caption ?? `[${rotulo}] ${validado.url}`)
  }

  readInbound(rawBody: string, signature: string): InboundReadResult {
    /*
     * HMAC sobre o corpo BRUTO, antes de qualquer parse — RNF-028. Validar
     * depois de `JSON.parse` e reserializar muda os bytes e reprova assinatura
     * legitima.
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

    const valor = valorDaMudanca(corpo)
    if (!valor) {
      return { status: 'malformed', reason: 'Corpo do webhook sem `entry[].changes[].value`.' }
    }

    /*
     * Recibo de entrega e atualizacao de status chegam no MESMO endpoint, em
     * `statuses` em vez de `messages`. Responder 4xx a eles faria o provedor
     * reentregar para sempre.
     */
    if (Array.isArray(valor.statuses) && !Array.isArray(valor.messages)) {
      return { status: 'ignored', reason: 'Recibo de entrega, nao mensagem recebida.' }
    }

    const mensagens = valor.messages
    if (!Array.isArray(mensagens) || mensagens.length === 0) {
      return { status: 'ignored', reason: 'Evento sem mensagem.' }
    }

    const bruta = mensagens[0] as Record<string, unknown>
    if (typeof bruta.id !== 'string' || typeof bruta.from !== 'string') {
      return { status: 'malformed', reason: 'Mensagem sem `id` ou `from`.' }
    }

    if (this.entradasVistas.has(bruta.id)) {
      return { status: 'ignored', reason: `Mensagem ${bruta.id} ja processada.` }
    }

    const metadados = valor.metadata as Record<string, unknown> | undefined
    const paraBruto = metadados?.display_phone_number
    if (typeof paraBruto !== 'string') {
      return { status: 'malformed', reason: 'Evento sem o numero da loja que recebeu.' }
    }

    const numeros = numerosDe(paraBruto, bruta.from)
    if (!numeros) {
      return { status: 'malformed', reason: 'Numero de origem ou destino invalido.' }
    }

    const recebidaEm = instanteDe(bruta.timestamp)
    const candidata = {
      providerMessageId: bruta.id,
      from: numeros.de,
      to: numeros.para,
      text: textoDe(bruta),
      media: midiaDe(bruta),
      receivedAt: recebidaEm,
    }

    const lida = inboundMessageSchema.safeParse(candidata)
    if (!lida.success) {
      return {
        status: 'malformed',
        reason: lida.error.issues[0]?.message ?? 'Mensagem recebida invalida.',
      }
    }

    this.entradasVistas.add(bruta.id)

    /*
     * Marca a janela de atendimento. A partir daqui, resposta a este cliente
     * pode sair como texto livre por 24 horas — e depois disso, nao.
     *
     * O adapter NAO decide se este numero esta vinculado a alguma empresa
     * (RF-094) nem se o texto e opt-out: as duas coisas dependem de cadastro,
     * que e de `core`. RF-095 exige ignorar numero nao vinculado *sem revelar
     * informacao*, o que significa que quem responde nao pode ser daqui.
     */
    this.ultimaEntrada.set(lida.data.from, new Date(lida.data.receivedAt).getTime())

    return { status: 'accepted', message: lida.data }
  }

  /* --- Apoio de teste: nao faz parte da porta --- */

  assinar(rawBody: string): string {
    return createHmac('sha256', this.opcoes.webhookSecret ?? SEGREDO_PADRAO)
      .update(rawBody, 'utf8')
      .digest('hex')
  }

  /** Monta o corpo aninhado que o provedor manda de verdade. */
  corpoDeEntrada(entrada: {
    providerMessageId: string
    from: string
    lojaNumero: string
    text?: string
    timestamp: string
  }): string {
    return JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { display_phone_number: entrada.lojaNumero },
                messages: [
                  {
                    id: entrada.providerMessageId,
                    from: entrada.from,
                    timestamp: String(Math.floor(new Date(entrada.timestamp).getTime() / 1000)),
                    type: 'text',
                    text: { body: entrada.text ?? 'oi' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
  }

  /** Corpo de recibo de entrega — o evento que chega e deve ser ignorado. */
  corpoDeRecibo(messageId: string, lojaNumero: string): string {
    return JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { display_phone_number: lojaNumero },
                statuses: [{ id: messageId, status: 'delivered' }],
              },
            },
          ],
        },
      ],
    })
  }

  private entregar(
    pedido: {
      companyId: string
      to: string
      idempotencyKey: string
      requestedAt: string
      consent: SendTextRequest['consent']
    },
    corpo: string,
  ): SendResult {
    /* Idempotencia primeiro: fila reprocessa, e mensagem repetida incomoda o
       cliente do lojista, que e quem ele menos quer incomodar. */
    const jaEnviada = this.porChave.get(pedido.idempotencyKey)
    if (jaEnviada) return jaEnviada

    const recusa = this.motivoDeRecusa(pedido)
    const resultado: SendResult = recusa
      ? { status: 'rejected', reason: recusa, message: mensagemDeRecusa(recusa) }
      : {
          status: 'sent',
          messageId: this.proximoId(),
          to: pedido.to,
          sentAt: pedido.requestedAt,
        }

    this.porChave.set(pedido.idempotencyKey, resultado)

    if (resultado.status === 'sent') {
      this.enviosPorEmpresa.set(
        pedido.companyId,
        (this.enviosPorEmpresa.get(pedido.companyId) ?? 0) + 1,
      )
      this.enviadas.push({
        messageId: resultado.messageId,
        companyId: pedido.companyId,
        to: pedido.to,
        body: corpo,
        sentAt: resultado.sentAt,
      })
    }

    return resultado
  }

  private motivoDeRecusa(pedido: {
    companyId: string
    to: string
    requestedAt: string
    consent: SendTextRequest['consent']
  }): SendRejectionReason | undefined {
    const configurada = this.opcoes.recusas?.[pedido.to]
    if (configurada) return configurada

    const limite = this.opcoes.limitePorEmpresa
    if (limite !== undefined && (this.enviosPorEmpresa.get(pedido.companyId) ?? 0) >= limite) {
      return 'rate_limited'
    }

    /*
     * A janela de 24 horas. Vale so para `service_reply`: e a base que DIZ ser
     * resposta a uma conversa que o cliente iniciou, e portanto e a unica que
     * pode estar mentindo sobre isso. `customer_opt_in` e `own_user` nao
     * dependem de janela.
     */
    if (pedido.consent.basis === 'service_reply') {
      /*
       * A janela e indexada pelo numero do CLIENTE, e nao pelo par
       * (loja, cliente): no recebimento o adapter conhece o numero da loja, no
       * envio conhece a empresa, e ele nao tem como ligar os dois — esse mapa e
       * de `core` (RF-094). Indexar por cliente e o que os dois lados
       * enxergam. O adapter real troca isto pelo id de conversa da Cloud API.
       */
      const ultima = this.ultimaEntrada.get(pedido.to)
      const agora = new Date(pedido.requestedAt).getTime()
      const referencia = ultima ?? new Date(pedido.consent.inboundAt).getTime()
      if (agora - referencia > JANELA_DE_ATENDIMENTO_MS) return 'outside_service_window'
    }

    return undefined
  }

  private assinaturaConfere(rawBody: string, signature: string): boolean {
    const esperada = Buffer.from(this.assinar(rawBody), 'utf8')
    const recebida = Buffer.from(signature, 'utf8')
    if (esperada.length !== recebida.length) return false
    return timingSafeEqual(esperada, recebida)
  }

  private proximoId(): string {
    this.sequencia += 1
    return `wamid.fake${String(this.sequencia).padStart(6, '0')}`
  }

  private talvezFalhar(): void {
    if (this.opcoes.falhaDeInfraestrutura) {
      throw new Error(this.opcoes.falhaDeInfraestrutura)
    }
  }
}

export function createFakeMessageSender(opcoes?: FakeMessageSenderOptions): FakeMessageSender {
  return new FakeMessageSender(opcoes)
}

/** Mensagens em PT-BR dizendo o que fazer, nao so o que houve — RNF-054. */
function mensagemDeRecusa(motivo: SendRejectionReason): string {
  switch (motivo) {
    case 'invalid_number':
      return 'Numero invalido. Confira o cadastro do cliente.'
    case 'not_on_whatsapp':
      return 'Este numero nao tem WhatsApp. Use outro canal para avisar o cliente.'
    case 'blocked_by_recipient':
      return 'O cliente bloqueou as mensagens da loja.'
    case 'outside_service_window':
      return 'Passaram 24 horas desde a ultima mensagem do cliente. Só é possível enviar uma mensagem de modelo aprovado.'
    case 'rate_limited':
      return 'Muitas mensagens em pouco tempo. A mensagem sera reenviada em instantes.'
  }
}

/** Navega o corpo aninhado do provedor sem estourar em nenhum nivel ausente. */
function valorDaMudanca(corpo: unknown): Record<string, unknown> | undefined {
  if (typeof corpo !== 'object' || corpo === null) return undefined
  const entry = (corpo as Record<string, unknown>).entry
  if (!Array.isArray(entry) || entry.length === 0) return undefined
  const changes = (entry[0] as Record<string, unknown>)?.changes
  if (!Array.isArray(changes) || changes.length === 0) return undefined
  const valor = (changes[0] as Record<string, unknown>)?.value
  if (typeof valor !== 'object' || valor === null) return undefined
  return valor as Record<string, unknown>
}

/** Normaliza os dois numeros de uma vez; qualquer um invalido invalida o par. */
function numerosDe(paraBruto: string, deBruto: string): { de: string; para: string } | undefined {
  const de = whatsappNumberSchema.safeParse(deBruto)
  const para = whatsappNumberSchema.safeParse(paraBruto)
  if (!de.success || !para.success) return undefined
  return { de: de.data, para: para.data }
}

/** O provedor manda `timestamp` em segundos, como string. */
function instanteDe(timestamp: unknown): string {
  if (typeof timestamp !== 'string' && typeof timestamp !== 'number') {
    return new Date(0).toISOString()
  }
  const segundos = Number(timestamp)
  if (!Number.isFinite(segundos)) return new Date(0).toISOString()
  return new Date(segundos * 1000).toISOString()
}

function textoDe(bruta: Record<string, unknown>): string | null {
  const texto = bruta.text as Record<string, unknown> | undefined
  return typeof texto?.body === 'string' ? texto.body : null
}

function midiaDe(bruta: Record<string, unknown>): {
  kind: 'image' | 'document'
  url: string
  filename: string | null
} | null {
  for (const kind of ['image', 'document'] as const) {
    const bloco = bruta[kind] as Record<string, unknown> | undefined
    if (bloco && typeof bloco.url === 'string') {
      return {
        kind,
        url: bloco.url,
        filename: typeof bloco.filename === 'string' ? bloco.filename : null,
      }
    }
  }
  return null
}
