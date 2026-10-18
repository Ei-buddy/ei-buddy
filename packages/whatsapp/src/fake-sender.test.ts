import { describe, expect, it } from 'vitest'
import { createFakeMessageSender } from './fake-sender.js'
import { pedidoDeTexto, verificarContratoDoRemetente } from './message-sender-contract.js'

verificarContratoDoRemetente('FakeMessageSender', () => createFakeMessageSender())

const EMPRESA = 'empresa-1'
const LOJA = '4133330000'
const CLIENTE = '41999990000'
const AGORA = '2026-09-02T13:00:00.000Z'

describe('recusa por destinatario', () => {
  it.each([
    ['invalid_number', 'Confira o cadastro'],
    ['not_on_whatsapp', 'nao tem WhatsApp'],
    ['blocked_by_recipient', 'bloqueou'],
  ] as const)('recusa %s com mensagem que diz o que fazer', async (motivo, trecho) => {
    const remetente = createFakeMessageSender({ recusas: { '5541999990000': motivo } })

    const resultado = await remetente.sendText(pedidoDeTexto())

    /* Recusa por destinatario e resultado, nao excecao: "numero nao tem
       WhatsApp" nao pode desfazer a venda que gerou o comprovante. */
    expect(resultado.status).toBe('rejected')
    if (resultado.status !== 'rejected') return
    expect(resultado.reason).toBe(motivo)
    expect(resultado.message).toContain(trecho)
  })

  it('nao registra entrega quando recusa', async () => {
    const remetente = createFakeMessageSender({
      recusas: { '5541999990000': 'blocked_by_recipient' },
    })

    await remetente.sendText(pedidoDeTexto())

    expect(remetente.entregues).toEqual([])
  })

  it('recusa por limite de taxa depois do teto da empresa', async () => {
    const remetente = createFakeMessageSender({ limitePorEmpresa: 2 })

    await remetente.sendText(pedidoDeTexto({ idempotencyKey: 'm1' }))
    await remetente.sendText(pedidoDeTexto({ idempotencyKey: 'm2' }))
    const terceira = await remetente.sendText(pedidoDeTexto({ idempotencyKey: 'm3' }))

    expect(terceira.status).toBe('rejected')
    if (terceira.status !== 'rejected') return
    expect(terceira.reason).toBe('rate_limited')
  })

  it('o limite e por empresa, nao global', async () => {
    const remetente = createFakeMessageSender({ limitePorEmpresa: 1 })

    await remetente.sendText(pedidoDeTexto({ idempotencyKey: 'm1' }))
    const outra = await remetente.sendText(
      pedidoDeTexto({ companyId: 'empresa-2', idempotencyKey: 'm2' }),
    )

    /* Uma loja movimentada nao pode calar a mensagem da loja do lado. */
    expect(outra.status).toBe('sent')
  })
})

describe('janela de atendimento de 24 horas', () => {
  it('permite resposta livre dentro da janela', async () => {
    const remetente = createFakeMessageSender()
    const corpo = remetente.corpoDeEntrada({
      providerMessageId: 'wamid.in1',
      from: CLIENTE,
      lojaNumero: LOJA,
      text: 'ja chegou meu pedido?',
      timestamp: '2026-09-02T12:00:00.000Z',
    })
    remetente.readInbound(corpo, remetente.assinar(corpo))

    const resultado = await remetente.sendText(
      pedidoDeTexto({
        consent: { basis: 'service_reply', inboundAt: '2026-09-02T12:00:00.000Z' },
      }),
    )

    expect(resultado.status).toBe('sent')
  })

  it('recusa resposta livre depois de 24 horas', async () => {
    const remetente = createFakeMessageSender()

    const resultado = await remetente.sendText(
      pedidoDeTexto({
        /* Cliente escreveu ha dois dias. */
        consent: { basis: 'service_reply', inboundAt: '2026-08-31T12:00:00.000Z' },
      }),
    )

    /*
     * Nao e erro nosso e retentar nao resolve: fora da janela so sai mensagem
     * de modelo aprovado. A mensagem tem de dizer isso, senao alguem vai ficar
     * reenfileirando para sempre.
     */
    expect(resultado.status).toBe('rejected')
    if (resultado.status !== 'rejected') return
    expect(resultado.reason).toBe('outside_service_window')
    expect(resultado.message).toContain('modelo aprovado')
  })

  it('consentimento do cliente nao depende de janela', async () => {
    const remetente = createFakeMessageSender()

    const resultado = await remetente.sendText(
      pedidoDeTexto({
        consent: { basis: 'customer_opt_in', recordedAt: '2026-01-01T00:00:00.000Z' },
      }),
    )

    /* Opt-in registrado nao expira em 24 horas — a janela e regra de conversa,
       nao de consentimento. */
    expect(resultado.status).toBe('sent')
  })

  it('mensagem para a propria lojista nao depende de janela', async () => {
    const remetente = createFakeMessageSender()

    const resultado = await remetente.sendText(
      pedidoDeTexto({ consent: { basis: 'own_user' }, to: LOJA }),
    )

    /* A lojista e usuaria do sistema, nao terceiro recebendo marketing. */
    expect(resultado.status).toBe('sent')
  })
})

describe('webhook de mensagem recebida', () => {
  it('aceita mensagem de texto e devolve os numeros normalizados', () => {
    const remetente = createFakeMessageSender()
    const corpo = remetente.corpoDeEntrada({
      providerMessageId: 'wamid.in1',
      from: CLIENTE,
      lojaNumero: LOJA,
      text: 'bom dia',
      timestamp: AGORA,
    })

    const leitura = remetente.readInbound(corpo, remetente.assinar(corpo))

    expect(leitura.status).toBe('accepted')
    if (leitura.status !== 'accepted') return
    expect(leitura.message.from).toBe('5541999990000')
    expect(leitura.message.to).toBe('554133330000')
    expect(leitura.message.text).toBe('bom dia')
  })

  it('ignora recibo de entrega, que chega no mesmo endpoint', () => {
    const remetente = createFakeMessageSender()
    const corpo = remetente.corpoDeRecibo('wamid.fake000001', LOJA)

    const leitura = remetente.readInbound(corpo, remetente.assinar(corpo))

    /* Responder 4xx a recibo faria o provedor reentregar para sempre. */
    expect(leitura.status).toBe('ignored')
    if (leitura.status !== 'ignored') return
    expect(leitura.reason).toContain('Recibo')
  })

  it('ignora reentrega da mesma mensagem', () => {
    const remetente = createFakeMessageSender()
    const corpo = remetente.corpoDeEntrada({
      providerMessageId: 'wamid.in2',
      from: CLIENTE,
      lojaNumero: LOJA,
      timestamp: AGORA,
    })
    const assinatura = remetente.assinar(corpo)

    expect(remetente.readInbound(corpo, assinatura).status).toBe('accepted')
    expect(remetente.readInbound(corpo, assinatura).status).toBe('ignored')
  })

  it('valida o HMAC sobre o corpo bruto: reserializar invalida', () => {
    const remetente = createFakeMessageSender()
    const corpo = remetente.corpoDeEntrada({
      providerMessageId: 'wamid.in3',
      from: CLIENTE,
      lojaNumero: LOJA,
      timestamp: AGORA,
    })
    const assinatura = remetente.assinar(corpo)
    const reserializado = JSON.stringify(JSON.parse(corpo), null, 2)

    expect(remetente.readInbound(corpo, assinatura).status).toBe('accepted')
    expect(remetente.readInbound(reserializado, assinatura).status).toBe('invalid_signature')
  })

  it('nao estoura em corpo aninhado incompleto', () => {
    const remetente = createFakeMessageSender()

    for (const corpo of [
      '{}',
      '{"entry":[]}',
      '{"entry":[{}]}',
      '{"entry":[{"changes":[]}]}',
      '{"entry":[{"changes":[{}]}]}',
    ]) {
      const leitura = remetente.readInbound(corpo, remetente.assinar(corpo))
      /* O corpo do provedor e fundo: cada nivel ausente e um TypeError em
         producao se o codigo confiar na forma. */
      expect(leitura.status).toBe('malformed')
    }
  })

  it('corpo ilegivel com assinatura valida e malformado, nao invalido', () => {
    const remetente = createFakeMessageSender()
    const corpo = 'isto nao e json'

    /* A distincao decide o codigo HTTP: 400 aqui, 401 na assinatura. */
    expect(remetente.readInbound(corpo, remetente.assinar(corpo)).status).toBe('malformed')
  })

  it('mensagem sem numero da loja e malformada', () => {
    const remetente = createFakeMessageSender()
    const corpo = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ id: 'wamid.x', from: CLIENTE, type: 'text', text: { body: 'oi' } }],
              },
            },
          ],
        },
      ],
    })

    /* Sem o numero que recebeu, `core` nao tem como achar a empresa — RF-094. */
    expect(remetente.readInbound(corpo, remetente.assinar(corpo)).status).toBe('malformed')
  })

  it('nao interpreta opt-out: entrega o texto e deixa a regra para core', () => {
    const remetente = createFakeMessageSender()
    const corpo = remetente.corpoDeEntrada({
      providerMessageId: 'wamid.in4',
      from: CLIENTE,
      lojaNumero: LOJA,
      text: 'PARAR',
      timestamp: AGORA,
    })

    const leitura = remetente.readInbound(corpo, remetente.assinar(corpo))

    /*
     * "PARAR" e opt-out? Depende de cadastro e de regra, e as duas coisas sao
     * de `core`. Adapter que interpreta e adapter que precisa ser reescrito
     * quando a regra muda.
     */
    expect(leitura.status).toBe('accepted')
    if (leitura.status !== 'accepted') return
    expect(leitura.message.text).toBe('PARAR')
  })

  it('respeita o segredo configurado', () => {
    const remetente = createFakeMessageSender({ webhookSecret: 'um-segredo' })
    const outro = createFakeMessageSender({ webhookSecret: 'outro-segredo' })
    const corpo = remetente.corpoDeEntrada({
      providerMessageId: 'wamid.in5',
      from: CLIENTE,
      lojaNumero: LOJA,
      timestamp: AGORA,
    })

    expect(remetente.readInbound(corpo, remetente.assinar(corpo)).status).toBe('accepted')
    expect(remetente.readInbound(corpo, outro.assinar(corpo)).status).toBe('invalid_signature')
  })
})

describe('falha de infraestrutura', () => {
  it('lanca, para o job ser retentado', async () => {
    const remetente = createFakeMessageSender({
      falhaDeInfraestrutura: 'token do WhatsApp invalido',
    })

    await expect(remetente.sendText(pedidoDeTexto())).rejects.toThrow('token')
  })
})

describe('presenca — lido e digitando', () => {
  it('registra lido e digitando na ordem das chamadas', async () => {
    const remetente = createFakeMessageSender()

    await remetente.markRead('wamid.a')
    await remetente.showTyping('wamid.b')
    await remetente.markRead('wamid.c')

    expect(remetente.sinais).toEqual([
      { messageId: 'wamid.a', kind: 'read' },
      { messageId: 'wamid.b', kind: 'typing' },
      { messageId: 'wamid.c', kind: 'read' },
    ])
  })

  it('falha de presenca registra a tentativa e nao lanca', async () => {
    const remetente = createFakeMessageSender({ falhaDePresenca: true })

    await expect(remetente.markRead('wamid.in1')).resolves.toBeUndefined()
    await expect(remetente.showTyping('wamid.in1')).resolves.toBeUndefined()

    expect(remetente.sinais).toEqual([
      { messageId: 'wamid.in1', kind: 'read' },
      { messageId: 'wamid.in1', kind: 'typing' },
    ])
  })
})

describe('registro de entrega', () => {
  it('guarda o que foi entregue, em ordem', async () => {
    const remetente = createFakeMessageSender()

    await remetente.sendText(pedidoDeTexto({ idempotencyKey: 'm1', body: 'primeira' }))
    await remetente.sendText(pedidoDeTexto({ idempotencyKey: 'm2', body: 'segunda' }))

    expect(remetente.entregues.map((m) => m.body)).toEqual(['primeira', 'segunda'])
  })

  it('registra a midia pelo nome do arquivo', async () => {
    const remetente = createFakeMessageSender()

    await remetente.sendMedia({
      companyId: EMPRESA,
      to: CLIENTE,
      consent: { basis: 'customer_opt_in', recordedAt: '2026-08-01T10:00:00.000Z' },
      idempotencyKey: 'mid-9',
      kind: 'document',
      url: 'https://fake.local/danfe/9.pdf',
      filename: 'nota-9.pdf',
      requestedAt: AGORA,
    })

    expect(remetente.entregues[0]?.body).toContain('nota-9.pdf')
  })
})
