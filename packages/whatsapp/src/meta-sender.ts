import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  InboundReadResult,
  SendMediaRequest,
  SendResult,
  SendTextRequest,
} from '@na-regua/contracts'

/**
 * Remetente Meta Cloud API — NR-046, ADR-0014, DEC-016.
 *
 * Satisfaz `MessageSender` (declarada em `core`) estruturalmente: a regra de
 * fronteira proibe `whatsapp` de importar `core`, entao o vocabulario vem de
 * `contracts` — mesmo desenho do gateway de pagamento e do emissor fiscal.
 *
 * ## Um numero, e nao um por loja
 *
 * A WABA e da PLATAFORMA (ADR-0014): um `phone-number-id`, um token. Nao ha
 * credencial por empresa aqui, e e por isso que o adapter nao tem porta de
 * credenciais como o do Asaas. Quem separa as lojas e o `peer` — o numero de
 * quem mandou —, resolvido em `core` (ADR-0012).
 *
 * ## O adapter nao interpreta
 *
 * Ele nao decide se o numero esta vinculado (RF-094/095) nem se o texto e um
 * pedido de opt-out. As duas coisas dependem de cadastro, que e de `core`, e a
 * RF-095 exige que numero nao vinculado seja ignorado SEM REVELAR INFORMACAO —
 * ou seja, quem responde nao pode ser o adapter.
 */

export type MetaOptions = {
  /** `WHATSAPP_PHONE_NUMBER_ID` — o identificador Graph do nosso numero. */
  readonly phoneNumberId: string
  /** `WHATSAPP_API_TOKEN` — o Bearer permanente do system user. */
  readonly apiToken: string
  /**
   * `WHATSAPP_WEBHOOK_SECRET` — o App Secret, para conferir o HMAC.
   *
   * Sem ele o adapter recusa TODO webhook, em vez de aceitar sem conferir.
   * Configuracao faltando nao pode virar porta aberta.
   */
  readonly webhookSecret?: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  /** Versao do Graph. Fixada por quem compoe, para nao mudar sozinha. */
  readonly versao?: string
}

const VERSAO_PADRAO = 'v21.0'
const TIMEOUT_PADRAO_MS = 15_000

/**
 * Os codigos de erro da Meta que sao RECUSA, e nao falha.
 *
 * Cada um vira uma razao do nosso vocabulario. O que nao estiver aqui LANCA:
 * token invalido e provedor fora do ar sao trabalho para retentar, e traduzi-
 * los em "recusado" faria a fila desistir de uma mensagem que sairia na
 * proxima tentativa.
 *
 * `131047` e o mais importante: passou a janela de 24h desde a ultima mensagem
 * do cliente, e fora dela so modelo aprovado sai. Nao e erro nosso e retentar
 * NAO resolve — por isso ele precisa chegar como recusa, e nao como excecao
 * que a fila tentaria cinco vezes.
 */
const RECUSAS: Record<number, { razao: SendRejectionReason; mensagem: string }> = {
  131047: {
    razao: 'outside_service_window',
    mensagem:
      'Passaram mais de 24 horas desde a ultima mensagem do cliente. Sem modelo aprovado, o WhatsApp nao entrega.',
  },
  131026: {
    razao: 'not_on_whatsapp',
    mensagem: 'Este numero nao tem WhatsApp.',
  },
  131051: {
    razao: 'invalid_number',
    mensagem: 'Numero invalido para WhatsApp.',
  },
  130429: {
    razao: 'rate_limited',
    mensagem: 'Muitas mensagens em pouco tempo. Tente de novo em instantes.',
  },
  131048: {
    razao: 'rate_limited',
    mensagem: 'O WhatsApp limitou o envio para este cliente. Tente de novo mais tarde.',
  },
}

type SendRejectionReason = Extract<SendResult, { status: 'rejected' }>['reason']

export function criarRemetenteMeta(opcoes: MetaOptions) {
  const buscar = opcoes.fetch ?? globalThis.fetch

  /**
   * O que ja foi enviado com cada chave de idempotencia.
   *
   * ## O provedor nao ajuda
   *
   * A Meta nao tem chave de idempotencia no POST de mensagem: reenviar o mesmo
   * corpo manda de novo, e o cliente recebe duas vezes — o lojista parecendo
   * insistente com o cliente dele. A porta promete que isso nao acontece,
   * entao a garantia sai daqui.
   *
   * ## O que isto cobre, e o que NAO cobre
   *
   * Cobre a retentativa da fila dentro do mesmo processo, que e o caso que a
   * porta descreve. **Nao cobre** reinicio do worker nem uma segunda
   * instancia: o mapa vive em memoria, e nao ha onde persisti-lo sem o adapter
   * alcancar banco — o que a fronteira proibe.
   *
   * A protecao duravel pertence a quem controla a fila (mesma ideia da caixa
   * de entrada de webhooks). Este mapa e a metade que cabe no adapter, e
   * dize-lo aqui e melhor que anunciar uma garantia maior do que a que existe.
   */
  const enviadas = new Map<string, SendResult>()
  const versao = opcoes.versao ?? VERSAO_PADRAO
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS
  const url = `https://graph.facebook.com/${versao}/${opcoes.phoneNumberId}/messages`

  async function enviar(
    corpo: Record<string, unknown>,
    toBruto: string,
    idempotencyKey: string,
  ): Promise<SendResult> {
    const jaFoi = enviadas.get(idempotencyKey)
    if (jaFoi !== undefined) return jaFoi

    /*
     * O cadastro guarda DDD + numero; a Meta exige o pais na frente. A
     * diferenca entre os dois e a origem de "a mensagem nao chegou e ninguem
     * sabe" — por isso a normalizacao acontece AQUI, na borda, e nao na
     * esperanca de que quem chama ja tenha feito.
     */
    const to = paraNumeroDaMeta(toBruto)

    const resposta = await buscar(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opcoes.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...corpo }),
      /* `AbortSignal.timeout` e nao um setTimeout solto: o segundo deixa a
         requisicao correndo depois de a promessa rejeitar. */
      signal: AbortSignal.timeout(timeoutMs),
    })

    const dados = (await resposta.json().catch(() => ({}))) as Record<string, unknown>

    if (!resposta.ok) return traduzirErro(dados)

    const mensagens = Array.isArray(dados.messages)
      ? (dados.messages as Record<string, unknown>[])
      : []
    const id = String(mensagens[0]?.id ?? '')

    if (id === '') {
      /*
       * 200 sem id nao e sucesso: sem ele nao ha como correlacionar o recibo
       * de entrega depois. Tratar como enviado deixaria a mensagem num limbo
       * — o sistema diria que saiu e nada confirmaria.
       */
      throw new Error('A Meta respondeu sem id da mensagem.')
    }

    const resultado: SendResult = {
      status: 'sent',
      messageId: id,
      to,
      sentAt: new Date().toISOString(),
    }

    /* So o ENVIO entra no mapa. Recusa nao: "numero invalido" hoje pode ser
       numero corrigido amanha, e guardar a recusa impediria a segunda
       tentativa legitima. */
    enviadas.set(idempotencyKey, resultado)
    return resultado
  }

  return {
    sendText: async (request: SendTextRequest): Promise<SendResult> =>
      enviar(
        {
          type: 'text',
          /* `preview_url: false` de proposito: link de pagamento com previa
             carregaria a pagina do provedor no aparelho do cliente antes de
             ele decidir abrir. */
          text: { body: request.body, preview_url: false },
        },
        request.to,
        request.idempotencyKey,
      ),

    sendMedia: async (request: SendMediaRequest): Promise<SendResult> => {
      const midia =
        request.kind === 'image'
          ? { type: 'image', image: { link: request.url } }
          : {
              type: 'document',
              document: {
                link: request.url,
                ...(request.filename === undefined ? {} : { filename: request.filename }),
              },
            }

      return enviar(midia, request.to, request.idempotencyKey)
    },

    readInbound: (rawBody: string, signature: string): InboundReadResult => {
      /* Segredo ausente recusa TUDO. Aceitar sem conferir seria transformar
         configuracao faltando em porta aberta — qualquer um postaria uma
         mensagem como se fosse o lojista. */
      if (opcoes.webhookSecret === undefined) return { status: 'invalid_signature' }
      if (!assinaturaConfere(rawBody, signature, opcoes.webhookSecret)) {
        return { status: 'invalid_signature' }
      }

      let corpo: Record<string, unknown>
      try {
        corpo = JSON.parse(rawBody) as Record<string, unknown>
      } catch {
        return { status: 'malformed', reason: 'Corpo do webhook nao e JSON.' }
      }

      return lerMensagem(corpo)
    },
  }
}

/**
 * O erro da Meta no nosso vocabulario.
 *
 * O que nao esta na tabela de recusas LANCA. A distincao e a mesma das outras
 * portas: recusa por DESTINATARIO e resultado — "esse numero nao tem WhatsApp"
 * nao pode desfazer a venda que gerou o comprovante —, e falha de
 * INFRAESTRUTURA e excecao, porque e trabalho para a fila retentar.
 *
 * Traduzir um token invalido em "recusado" faria a fila desistir de uma
 * mensagem que sairia na proxima tentativa; traduzir a janela de 24h em
 * excecao faria ela tentar cinco vezes uma coisa que nunca vai sair.
 */
function traduzirErro(dados: Record<string, unknown>): SendResult {
  const erro = (dados.error ?? {}) as Record<string, unknown>
  const codigo = Number(erro.code ?? 0)
  const recusa = RECUSAS[codigo]

  if (recusa === undefined) {
    throw new Error(
      `A Meta recusou o envio (codigo ${codigo || '?'}): ${String(erro.message ?? 'sem detalhe')}`,
    )
  }

  return { status: 'rejected', reason: recusa.razao, message: recusa.mensagem }
}

/**
 * A mensagem dentro do envelope da Meta.
 *
 * O corpo vem em tres niveis — `entry[].changes[].value` — e quase tudo que
 * chega ali NAO e mensagem: recibo de entrega, atualizacao de status, evento
 * de outra versao da API. Esses viram `ignored`, e nao erro: 4xx faria a Meta
 * reentregar para sempre algo que nunca vamos querer.
 */
function lerMensagem(corpo: Record<string, unknown>): InboundReadResult {
  const entradas = Array.isArray(corpo.entry) ? (corpo.entry as Record<string, unknown>[]) : []
  const mudancas = entradas.flatMap((e) =>
    Array.isArray(e.changes) ? (e.changes as Record<string, unknown>[]) : [],
  )

  const valores = mudancas.map((c) => (c.value ?? {}) as Record<string, unknown>)

  const comMensagem = valores.find((v) => Array.isArray(v.messages) && v.messages.length > 0)
  if (comMensagem === undefined) {
    return { status: 'ignored', reason: 'Aviso sem mensagem — recibo ou status.' }
  }

  const mensagem = (comMensagem.messages as Record<string, unknown>[])[0]!
  const metadados = (comMensagem.metadata ?? {}) as Record<string, unknown>

  const providerMessageId = String(mensagem.id ?? '')
  const from = String(mensagem.from ?? '')
  const to = String(metadados.display_phone_number ?? '')

  if (providerMessageId === '' || from === '' || to === '') {
    return { status: 'malformed', reason: 'Mensagem sem id, remetente ou destino.' }
  }

  const texto = (mensagem.text ?? {}) as Record<string, unknown>

  return {
    status: 'accepted',
    message: {
      providerMessageId,
      from,
      to,
      text: typeof texto.body === 'string' ? texto.body : null,
      /*
       * Midia recebida fica de fora deste recorte: a Meta entrega um ID, e
       * baixar o arquivo e outra chamada autenticada, com guarda propria de
       * tamanho e tipo. Anunciar `media` sem baixar daria a `core` uma URL que
       * nao abre.
       */
      media: null,
      /* `timestamp` vem em SEGUNDOS, como string. Tratar como milissegundos
         poria toda conversa em 1970. */
      receivedAt: instanteDaMeta(mensagem.timestamp),
    },
  }
}

/**
 * O numero no formato que a Meta exige.
 *
 * Mesma regra de `whatsappNumberSchema`: 10 ou 11 digitos e DDD + numero sem
 * pais, e o 55 entra na frente. Mais que isso ja vem com pais e passa
 * inteiro — assim um numero que ja chegou certo nao ganha um 55 duplicado.
 */
function paraNumeroDaMeta(bruto: string): string {
  const digitos = bruto.replace(/\D/g, '')
  return digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos
}

function instanteDaMeta(bruto: unknown): string {
  const segundos = Number(bruto ?? NaN)
  return Number.isFinite(segundos)
    ? new Date(segundos * 1000).toISOString()
    : new Date().toISOString()
}

/**
 * HMAC sobre os BYTES que chegaram — RNF-028.
 *
 * A Meta manda `sha256=<hex>` em `X-Hub-Signature-256`, e o prefixo faz parte
 * do cabecalho. Comparacao em tempo constante: `===` vazaria, pelo tempo de
 * resposta, quanto do prefixo bateu.
 *
 * Aqui o HMAC E sobre o corpo — ao contrario do Asaas, que usa token estatico.
 * E por isso que a porta recebe o corpo bruto: reserializar depois de
 * `JSON.parse` muda os bytes e nenhuma assinatura legitima passa.
 */
function assinaturaConfere(rawBody: string, cabecalho: string, segredo: string): boolean {
  const recebida = cabecalho.trim().replace(/^sha256=/, '')
  const esperada = createHmac('sha256', segredo).update(rawBody, 'utf8').digest('hex')

  const a = Buffer.from(recebida, 'utf8')
  const b = Buffer.from(esperada, 'utf8')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

/**
 * O handshake de verificacao do webhook — `GET` com `hub.*`.
 *
 * A Meta chama uma vez, ao cadastrar a URL, e espera o `hub.challenge` de
 * volta EM TEXTO PURO. Devolver JSON faz a verificacao falhar sem dizer por
 * que, e a URL nunca e ativada.
 *
 * Fora do `MessageSender` de proposito: a porta fala de mensagens, e isto e
 * cerimonia de cadastro do provedor.
 */
export function responderVerificacao(
  entrada: { readonly mode: string; readonly token: string; readonly challenge: string },
  verifyToken: string | undefined,
): string | undefined {
  if (verifyToken === undefined) return undefined
  if (entrada.mode !== 'subscribe') return undefined

  const a = Buffer.from(entrada.token, 'utf8')
  const b = Buffer.from(verifyToken, 'utf8')
  if (a.length !== b.length || a.length === 0) return undefined
  return timingSafeEqual(a, b) ? entrada.challenge : undefined
}
