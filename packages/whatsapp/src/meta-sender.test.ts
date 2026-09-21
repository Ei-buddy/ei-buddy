import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { criarRemetenteMeta, responderVerificacao } from './meta-sender.js'
import { pedidoDeTexto, verificarContratoDoRemetente } from './message-sender-contract.js'

/**
 * O adapter da Meta contra uma Meta falsa — NR-046, ADR-0014.
 *
 * O duble vive AQUI e nao em `src`: ele nao e produto. O que ele imita e a
 * FORMA da API — o envelope de tres niveis do webhook, o `timestamp` em
 * segundos, os codigos de erro —, nao a regra de negocio dela.
 */

const SEGREDO = 'app-secret-de-teste'
const PHONE_ID = '123456789'

function metaFalsa(resposta?: { status: number; corpo: unknown }) {
  const enviados: { url: string; corpo: Record<string, unknown> }[] = []

  const fetchFalso: typeof globalThis.fetch = async (entrada, init) => {
    enviados.push({
      url: String(entrada),
      corpo: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })

    const r = resposta ?? {
      status: 200,
      corpo: { messages: [{ id: `wamid.${enviados.length}` }] },
    }

    return new Response(JSON.stringify(r.corpo), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    })
  }

  return { fetchFalso, enviados }
}

function remetente(extra: { fetchFalso?: typeof globalThis.fetch } = {}) {
  const { fetchFalso } = metaFalsa()
  return criarRemetenteMeta({
    phoneNumberId: PHONE_ID,
    apiToken: 'token-de-teste',
    webhookSecret: SEGREDO,
    fetch: extra.fetchFalso ?? fetchFalso,
  })
}

verificarContratoDoRemetente('meta', () => remetente())

const assinar = (corpo: string, segredo = SEGREDO) =>
  `sha256=${createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex')}`

describe('o que e proprio do adapter da Meta', () => {
  it('manda para o endpoint do nosso numero, com o Bearer', async () => {
    const m = metaFalsa()
    await remetente({ fetchFalso: m.fetchFalso }).sendText(pedidoDeTexto())

    expect(m.enviados[0]?.url).toContain(`/${PHONE_ID}/messages`)
    expect(m.enviados[0]?.corpo).toMatchObject({ messaging_product: 'whatsapp', type: 'text' })
  })

  it('desliga a previa do link', async () => {
    const m = metaFalsa()
    await remetente({ fetchFalso: m.fetchFalso }).sendText(pedidoDeTexto())

    /* Previa carregaria a pagina do provedor de pagamento no aparelho do
       cliente antes de ele decidir abrir. */
    expect(m.enviados[0]?.corpo).toMatchObject({ text: { preview_url: false } })
  })

  it('a janela de 24h vira RECUSA, e nao excecao', async () => {
    const { fetchFalso } = metaFalsa({
      status: 400,
      corpo: { error: { code: 131047, message: 're-engagement message' } },
    })

    const r = await remetente({ fetchFalso }).sendText(pedidoDeTexto())

    /*
     * Excecao aqui faria a fila tentar cinco vezes uma coisa que nunca vai
     * sair: passou a janela, e so modelo aprovado entrega. Nao e erro nosso e
     * retentar nao resolve.
     */
    if (r.status !== 'rejected') throw new Error('esperava recusa')
    expect(r.reason).toBe('outside_service_window')
    expect(r.message).toMatch(/24 horas/i)
  })

  it('erro de infraestrutura LANCA, porque a fila deve retentar', async () => {
    const { fetchFalso } = metaFalsa({
      status: 401,
      corpo: { error: { code: 190, message: 'Invalid OAuth access token' } },
    })

    /* Traduzir token invalido em "recusado" faria a fila desistir de uma
       mensagem que sairia na proxima tentativa. */
    await expect(remetente({ fetchFalso }).sendText(pedidoDeTexto())).rejects.toThrow(/190/)
  })

  it('200 sem id da mensagem LANCA, em vez de fingir que saiu', async () => {
    const { fetchFalso } = metaFalsa({ status: 200, corpo: { messages: [] } })

    /* Sem id nao ha como correlacionar o recibo de entrega: o sistema diria
       que saiu e nada confirmaria. */
    await expect(remetente({ fetchFalso }).sendText(pedidoDeTexto())).rejects.toThrow(/id/i)
  })
})

describe('webhook da Meta — RNF-028', () => {
  const corpoComMensagem = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { display_phone_number: '5541999990000' },
              messages: [
                {
                  id: 'wamid.ABC',
                  from: '5541988887777',
                  timestamp: '1790000000',
                  type: 'text',
                  text: { body: 'tem coca 2l?' },
                },
              ],
            },
          },
        ],
      },
    ],
  })

  it('le a mensagem de dentro do envelope de tres niveis', () => {
    const r = remetente().readInbound(corpoComMensagem, assinar(corpoComMensagem))

    if (r.status !== 'accepted') throw new Error('esperava aceito')
    expect([r.message.from, r.message.text]).toEqual(['5541988887777', 'tem coca 2l?'])
  })

  it('o timestamp vem em SEGUNDOS', () => {
    const r = remetente().readInbound(corpoComMensagem, assinar(corpoComMensagem))

    if (r.status !== 'accepted') throw new Error('esperava aceito')
    /* Tratar como milissegundos poria toda conversa em 1970. */
    expect(r.message.receivedAt).toBe(new Date(1_790_000_000 * 1000).toISOString())
  })

  it('assinatura errada NAO vira 200', () => {
    expect(
      remetente().readInbound(corpoComMensagem, assinar(corpoComMensagem, 'outro')).status,
    ).toBe('invalid_signature')
  })

  it('corpo alterado depois de assinado e recusado', () => {
    /* Aqui o HMAC E sobre o corpo, ao contrario do Asaas. Reserializar depois
       de parsear quebraria a conferencia — e e por isso que a porta recebe os
       bytes crus. */
    const adulterado = corpoComMensagem.replace('coca', 'pinga')
    expect(remetente().readInbound(adulterado, assinar(corpoComMensagem)).status).toBe(
      'invalid_signature',
    )
  })

  it('sem segredo configurado recusa tudo', () => {
    const sem = criarRemetenteMeta({
      phoneNumberId: PHONE_ID,
      apiToken: 'token',
      fetch: async () => new Response('{}'),
    })

    expect(sem.readInbound(corpoComMensagem, assinar(corpoComMensagem)).status).toBe(
      'invalid_signature',
    )
  })

  it('recibo de entrega e IGNORADO, e nao erro', () => {
    const recibo = JSON.stringify({
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.ABC', status: 'delivered' }] } }] }],
    })

    /* 4xx faria a Meta reentregar para sempre algo que nunca vamos querer. */
    expect(remetente().readInbound(recibo, assinar(recibo)).status).toBe('ignored')
  })

  it('mensagem sem remetente responde malformed', () => {
    const quebrado = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.X' }] } }] }],
    })

    expect(remetente().readInbound(quebrado, assinar(quebrado)).status).toBe('malformed')
  })
})

describe('handshake de verificacao', () => {
  it('devolve o challenge quando o token bate', () => {
    expect(
      responderVerificacao(
        { mode: 'subscribe', token: 'meu-verify', challenge: '12345' },
        'meu-verify',
      ),
    ).toBe('12345')
  })

  it('token errado nao devolve nada', () => {
    expect(
      responderVerificacao(
        { mode: 'subscribe', token: 'chutado', challenge: '12345' },
        'meu-verify',
      ),
    ).toBeUndefined()
  })

  it('sem verify token configurado, nao verifica', () => {
    expect(
      responderVerificacao({ mode: 'subscribe', token: 'qualquer', challenge: '1' }, undefined),
    ).toBeUndefined()
  })
})
