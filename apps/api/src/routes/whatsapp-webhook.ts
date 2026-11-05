import {
  FRASE_PEDIDO_DE_TEXTO,
  processMessage,
  type AgentRuntime,
  type IncomingMessage,
  type PeerDirectory,
} from '@na-regua/agent'
import type { AgentReply, SendTextRequest } from '@na-regua/contracts'
import type { WebhookInbox } from '@na-regua/core'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  dividirRespostaWhatsapp,
  formatarTextoWhatsApp,
  responderVerificacao,
  type criarRemetenteMeta,
} from '@na-regua/whatsapp'

export type WhatsAppWebhookRouteDeps = {
  /**
   * Handshake GET da Meta — basta `WHATSAPP_VERIFY_TOKEN`. Ausente: GET 503.
   */
  readonly verificacao?: {
    readonly verifyToken: string
  }
  /**
   * POST inbound — exige `WHATSAPP_PROVIDER=meta`, token de envio, phone id e
   * App Secret (`WHATSAPP_WEBHOOK_SECRET`). Ausente: POST 503 ou 401 se só o
   * verify token estiver configurado.
   */
  readonly meta?:
    | {
        readonly remetente: ReturnType<typeof criarRemetenteMeta>
        readonly peers: PeerDirectory
        readonly inbox: WebhookInbox
        /** Ausente quando o assistente nao montou; texto vazio ainda recebe frase fixa. */
        readonly runtime?: AgentRuntime
        /**
         * Permite substituir em teste. Produção usa `processMessage` no runtime
         * com `peers` do webhook.
         */
        readonly executarTurno?: (
          runtime: AgentRuntime,
          input: IncomingMessage,
        ) => Promise<AgentReply>
      }
    | undefined
  /**
   * Pausa da rajada, intervalo entre balões e renovação do digitando.
   * Ausente: `setTimeout`. Teste injeta um relógio para não dormir.
   */
  readonly scheduler?: {
    esperar(ms: number): Promise<void>
  }
  /**
   * Relógio de “agora” para decidir se o carimbo da Meta está atrasado.
   * Ausente: `new Date()`. Teste injeta o instante do cenário.
   */
  readonly agora?: () => Date
}

const INDISPONIVEL = { error: { code: 'UNAVAILABLE' as const } }
const PROVEDOR = 'meta'
const CABECALHO_ASSINATURA = 'x-hub-signature-256'

/** Mensagem fixa quando a dona manda mídia ou corpo vazio — sem modelo (RNF-073). */
export const FRASE_PEDIDO_DE_TEXTO_WHATSAPP = FRASE_PEDIDO_DE_TEXTO

const FRASE_DE_FALHA_WHATSAPP = 'Não consegui responder agora. Tente de novo em instantes.'

const RESPOSTAS_VISIVEIS = new Set<AgentReply['kind']>([
  'answer',
  'clarify',
  'unknown',
  'confirmation',
])

/** Depois do último texto com conteúdo, antes de chamar o assistente. */
const PAUSA_DA_RAJADA_MS = 3_000
/** Digitando e espera entre um balão e o seguinte. O primeiro não espera. */
const INTERVALO_ENTRE_BALOES_MS = 800
/** O provedor apaga o digitando em 25 s; renovamos se a resposta ainda não saiu. */
const RENOVACAO_DIGITANDO_MS = 20_000
/**
 * Reentrega da Meta conserva o `timestamp` original. Acima disto a dona já
 * seguiu a conversa — responder agora parece mensagem espontânea.
 * Entrega ao vivo chegou em ~6 s; as de “Oi” reentregues tinham 22–100 min.
 */
const ATRASO_MAXIMO_MS = 3 * 60_000

type MetaPronta = NonNullable<WhatsAppWebhookRouteDeps['meta']>

type Fragmento = {
  readonly id: string
  readonly texto: string
  readonly receivedAt: string
  readonly companyId: string
  readonly from: string
  readonly requestId: string
  readonly now: Date
}

type Sequencia = {
  readonly fragmentos: Fragmento[]
  readonly ids: Set<string>
  geracao: number
  iniciada: boolean
  /** O prazo venceu enquanto outro turno da mesma conversa ainda respondia. */
  vencida: boolean
  readonly conclusao: Promise<void>
  concluir: () => void
  rejeitar: (erro: unknown) => void
}

type EstadoDaConversa = {
  espera: Sequencia | null
  curso: Sequencia | null
}

/**
 * Webhook do WhatsApp — NR-046, RNF-028.
 *
 * Mesmo desenho do Asaas: escopo com parser de corpo em string, sem sessao.
 * O HMAC da Meta e sobre os bytes que chegaram; reserializar depois de
 * `JSON.parse` muda a assinatura e nenhum POST legitimo passa.
 */
export function registerWhatsAppWebhookRoutes(
  app: FastifyInstance,
  deps: WhatsAppWebhookRouteDeps,
): void {
  const scheduler = deps.scheduler ?? {
    esperar: (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(() => resolve(), ms)
      }),
  }

  /*
   * A rajada vive neste processo, como o mapa de idempotencia do envio.
   * Duas instancias nao juntam textos uma da outra.
   */
  const porChave = new Map<string, EstadoDaConversa>()
  const porId = new Map<string, Sequencia>()

  void app.register(
    async (escopo) => {
      escopo.addContentTypeParser(
        'application/json',
        { parseAs: 'string' },
        (_request, body, done) => {
          done(null, body)
        },
      )

      escopo.get('/whatsapp', async (request, reply) => {
        const verifyToken = deps.verificacao?.verifyToken
        if (verifyToken === undefined) {
          return reply.code(503).send(INDISPONIVEL)
        }

        const consulta = request.query as Record<string, string | undefined>
        const challenge = responderVerificacao(
          {
            mode: consulta['hub.mode'] ?? '',
            token: consulta['hub.verify_token'] ?? '',
            challenge: consulta['hub.challenge'] ?? '',
          },
          verifyToken,
        )

        if (challenge === undefined) {
          return reply.code(403).send()
        }

        return reply.type('text/plain').code(200).send(challenge)
      })

      escopo.post('/whatsapp', async (request, reply) => {
        const meta = deps.meta
        if (meta === undefined) {
          if (deps.verificacao !== undefined) {
            return reply
              .code(401)
              .send({ error: { code: 'UNAUTHORIZED', message: 'Nao autorizado.' } })
          }
          return reply.code(503).send(INDISPONIVEL)
        }

        const corpoBruto = typeof request.body === 'string' ? request.body : ''
        const assinatura = cabecalhoAssinatura(request)
        const leitura = meta.remetente.readInbound(corpoBruto, assinatura)

        if (leitura.status === 'invalid_signature') {
          return reply
            .code(401)
            .send({ error: { code: 'UNAUTHORIZED', message: 'Nao autorizado.' } })
        }
        if (leitura.status === 'malformed') {
          return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: leitura.reason } })
        }
        if (leitura.status === 'ignored') {
          return reply.code(200).send()
        }

        const inbound = leitura.message
        const vinculo = await meta.peers.resolve(inbound.from)
        if (vinculo === null) {
          /* Número sem vínculo, inativo ou não-dona: não grava, não chama o
             assistente, não envia (data-model NR-046). */
          return reply.code(200).send()
        }

        const texto = inbound.text?.trim() ?? ''
        const kind = texto === '' ? 'empty' : 'text'
        const agora = new Date()
        const requestId = request.id

        const situacao = await meta.inbox.registrar({
          provider: PROVEDOR,
          eventId: inbound.providerMessageId,
          companyId: vinculo.companyId,
          payload: { kind, id: inbound.providerMessageId },
          receivedAt: agora,
        })

        if (situacao === 'processado') {
          return reply.code(200).send()
        }

        const relogio = deps.agora ?? (() => new Date())
        const enviadaEm = Date.parse(inbound.receivedAt)
        const idadeMs = Number.isFinite(enviadaEm) ? relogio().getTime() - enviadaEm : 0
        if (idadeMs > ATRASO_MAXIMO_MS) {
          await marcarProcessado(meta, vinculo.companyId, [inbound.providerMessageId])
          return reply.code(200).send()
        }

        request.log.info(
          { requestId, companyId: vinculo.companyId, userId: vinculo.userId },
          'whatsapp webhook turno',
        )

        await chamarPresenca(() => meta.remetente.markRead(inbound.providerMessageId))

        if (texto === '') {
          /* Foto, áudio ou só espaços: frase fixa já, sem entrar na pausa e
             sem reiniciar a rajada que já esteja esperando. */
          await chamarPresenca(() => meta.remetente.showTyping(inbound.providerMessageId))
          await enviarTexto(meta, {
            companyId: vinculo.companyId,
            to: inbound.from,
            body: FRASE_PEDIDO_DE_TEXTO_WHATSAPP,
            inboundAt: inbound.receivedAt,
            idempotencyKey: `${inbound.providerMessageId}:1`,
            requestedAt: agora.toISOString(),
          })
          await marcarProcessado(meta, vinculo.companyId, [inbound.providerMessageId])
          return reply.code(200).send()
        }

        const fragmento: Fragmento = {
          id: inbound.providerMessageId,
          texto,
          receivedAt: inbound.receivedAt,
          companyId: vinculo.companyId,
          from: inbound.from,
          requestId,
          now: agora,
        }

        const sequencia = entrarNaSequencia(fragmento)
        await sequencia.conclusao
        return reply.code(200).send()
      })
    },
    { prefix: '/webhooks' },
  )

  function entrarNaSequencia(fragmento: Fragmento): Sequencia {
    const jaVista = porId.get(fragmento.id)
    if (jaVista !== undefined) return jaVista

    const chave = chaveDaConversa(fragmento.companyId, fragmento.from)
    const estado = estadoDa(chave)
    if (estado.espera === null) {
      estado.espera = criarSequencia()
    }

    const sequencia = estado.espera
    sequencia.fragmentos.push(fragmento)
    sequencia.ids.add(fragmento.id)
    porId.set(fragmento.id, sequencia)
    armarPrazo(chave, sequencia)
    return sequencia
  }

  function estadoDa(chave: string): EstadoDaConversa {
    const existente = porChave.get(chave)
    if (existente !== undefined) return existente
    const criado: EstadoDaConversa = { espera: null, curso: null }
    porChave.set(chave, criado)
    return criado
  }

  function armarPrazo(chave: string, sequencia: Sequencia): void {
    sequencia.geracao += 1
    sequencia.vencida = false
    const geracao = sequencia.geracao
    void scheduler.esperar(PAUSA_DA_RAJADA_MS).then(() => {
      vencerPrazo(chave, sequencia, geracao)
    })
  }

  function vencerPrazo(chave: string, sequencia: Sequencia, geracao: number): void {
    if (sequencia.geracao !== geracao) return
    const estado = porChave.get(chave)
    if (estado === undefined || estado.espera !== sequencia) return
    if (estado.curso !== null) {
      sequencia.vencida = true
      return
    }
    disparar(chave, sequencia)
  }

  function disparar(chave: string, sequencia: Sequencia): void {
    const estado = porChave.get(chave)
    if (estado === undefined) return
    if (sequencia.iniciada || estado.curso !== null || estado.espera !== sequencia) return

    sequencia.iniciada = true
    estado.espera = null
    estado.curso = sequencia
    void concluirTurno(chave, estado, sequencia)
  }

  async function concluirTurno(
    chave: string,
    estado: EstadoDaConversa,
    sequencia: Sequencia,
  ): Promise<void> {
    try {
      await executarTurno(sequencia)
      sequencia.concluir()
    } catch (erro) {
      sequencia.rejeitar(erro)
    } finally {
      if (estado.curso === sequencia) estado.curso = null
      for (const id of sequencia.ids) porId.delete(id)

      const proxima = estado.espera
      if (proxima !== null && proxima.vencida) disparar(chave, proxima)

      if (estado.curso === null && estado.espera === null) porChave.delete(chave)
    }
  }

  async function executarTurno(sequencia: Sequencia): Promise<void> {
    const meta = deps.meta
    if (meta === undefined) return

    const fragmentos = [...sequencia.fragmentos]
    const primeiro = fragmentos[0]
    const ultimo = fragmentos[fragmentos.length - 1]
    if (primeiro === undefined || ultimo === undefined) return

    const turno = meta.executarTurno ?? ((runtime, input) => processMessage(runtime, input))
    const texto = fragmentos.map((fragmento) => fragmento.texto).join('\n')
    let partes: string[] = []

    if (meta.runtime !== undefined) {
      await chamarPresenca(() => meta.remetente.showTyping(ultimo.id))
      try {
        const resposta = await renovarDigitando(
          meta,
          ultimo.id,
          turno(meta.runtime, {
            text: texto,
            requestId: primeiro.requestId,
            now: primeiro.now,
            channel: 'whatsapp',
            peer: primeiro.from,
          }),
        )
        if (RESPOSTAS_VISIVEIS.has(resposta.kind) && resposta.text.trim() !== '') {
          partes = dividirRespostaWhatsapp(formatarTextoWhatsApp(resposta.text))
        }
      } catch {
        await enviarTexto(meta, {
          companyId: primeiro.companyId,
          to: primeiro.from,
          body: FRASE_DE_FALHA_WHATSAPP,
          inboundAt: primeiro.receivedAt,
          idempotencyKey: `${primeiro.id}:1`,
          requestedAt: new Date().toISOString(),
        })
        await marcarProcessado(
          meta,
          primeiro.companyId,
          fragmentos.map((fragmento) => fragmento.id),
        )
        return
      }
    }

    const pedidoEm = new Date().toISOString()
    for (let indice = 0; indice < partes.length; indice += 1) {
      const parte = partes[indice]
      if (parte === undefined || parte.trim() === '') continue
      if (indice > 0) {
        await chamarPresenca(() => meta.remetente.showTyping(ultimo.id))
        await scheduler.esperar(INTERVALO_ENTRE_BALOES_MS)
      }
      await enviarTexto(meta, {
        companyId: primeiro.companyId,
        to: primeiro.from,
        body: parte,
        inboundAt: primeiro.receivedAt,
        idempotencyKey: `${primeiro.id}:${indice + 1}`,
        requestedAt: pedidoEm,
      })
    }

    await marcarProcessado(
      meta,
      primeiro.companyId,
      fragmentos.map((fragmento) => fragmento.id),
    )
  }

  async function renovarDigitando<T>(
    meta: MetaPronta,
    messageId: string,
    trabalho: Promise<T>,
  ): Promise<T> {
    let terminou = false
    const encerrado = trabalho.then(
      (valor) => {
        terminou = true
        return { ok: true as const, valor }
      },
      (erro: unknown) => {
        terminou = true
        return { ok: false as const, erro }
      },
    )

    while (!terminou) {
      const sinal = await Promise.race([
        encerrado.then(() => 'pronto' as const),
        scheduler.esperar(RENOVACAO_DIGITANDO_MS).then(() => 'espera' as const),
      ])
      if (terminou || sinal === 'pronto') break
      await chamarPresenca(() => meta.remetente.showTyping(messageId))
    }

    const resultado = await encerrado
    if (!resultado.ok) throw resultado.erro
    return resultado.valor
  }
}

function criarSequencia(): Sequencia {
  let resolver: () => void = () => undefined
  let rejeitarPromise: (erro: unknown) => void = () => undefined
  let encerrada = false
  const conclusao = new Promise<void>((resolve, reject) => {
    resolver = resolve
    rejeitarPromise = reject
  })
  /*
   * O prazo pode rejeitar esta promessa no mesmo instante em que o handler
   * ainda está entrando no await. O catch evita rejeição sem ouvinte; quem
   * espera a sequência continua vendo o erro.
   */
  void conclusao.catch((erro: unknown) => {
    void erro
  })

  return {
    fragmentos: [],
    ids: new Set(),
    geracao: 0,
    iniciada: false,
    vencida: false,
    conclusao,
    concluir: () => {
      if (encerrada) return
      encerrada = true
      resolver()
    },
    rejeitar: (erro: unknown) => {
      if (encerrada) return
      encerrada = true
      rejeitarPromise(erro)
    },
  }
}

function chaveDaConversa(companyId: string, from: string): string {
  return `${companyId}\0${from}`
}

async function chamarPresenca(acao: () => Promise<void>): Promise<void> {
  try {
    await acao()
  } catch (erro) {
    /* Lido e digitando não podem segurar a resposta nem o turno seguinte. */
    void erro
  }
}

async function enviarTexto(
  meta: MetaPronta,
  pedido: {
    companyId: string
    to: string
    body: string
    inboundAt: string
    idempotencyKey: string
    requestedAt: string
  },
): Promise<void> {
  const mensagem: SendTextRequest = {
    companyId: pedido.companyId,
    to: pedido.to,
    body: pedido.body,
    consent: { basis: 'service_reply', inboundAt: pedido.inboundAt },
    idempotencyKey: pedido.idempotencyKey,
    requestedAt: pedido.requestedAt,
  }
  await meta.remetente.sendText(mensagem)
}

async function marcarProcessado(
  meta: MetaPronta,
  companyId: string,
  ids: readonly string[],
): Promise<void> {
  const processedAt = new Date()
  for (const eventId of ids) {
    await meta.inbox.marcarProcessado({
      provider: PROVEDOR,
      eventId,
      companyId,
      processedAt,
    })
  }
}

function cabecalhoAssinatura(request: FastifyRequest): string {
  const bruto = request.headers[CABECALHO_ASSINATURA]
  return typeof bruto === 'string' ? bruto : ''
}
