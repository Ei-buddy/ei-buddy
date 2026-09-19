import { describe, expect, it } from 'vitest'
import { criarProvedorDeAssinaturaAsaas } from './asaas-subscription-provider.js'
import {
  pedidoDeAssinatura,
  verificarContratoDeAssinatura,
} from './subscription-provider-contract.js'

/**
 * O adapter de assinatura contra um Asaas falso — NR-063.
 *
 * O falso vive AQUI e nao em `src`: ele nao e produto, e um duble de teste. O
 * que ele imita e a FORMA da API — caminhos, campos, decimal no valor, e o
 * token estatico no cabecalho do webhook —, nao a regra de negocio dela.
 *
 * Uma chave so, e de proposito: a mensalidade e cobrada na CONTA-PAI. Se este
 * duble guardasse por chave, como o de `payments`, estaria imitando a conta
 * errada.
 */

const TOKEN = 'token-de-aviso-da-conta-pai'

function asaasFalso() {
  const assinaturas = new Map<string, Record<string, unknown>>()
  let sequencia = 0

  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

  const fetchFalso: typeof globalThis.fetch = async (entrada, init) => {
    const url = new URL(String(entrada))
    const caminho = url.pathname.replace('/v3', '')
    const metodo = init?.method ?? 'GET'
    const corpo =
      init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>)

    if (caminho === '/subscriptions' && metodo === 'POST') {
      sequencia += 1
      const id = `sub_${sequencia}`
      const criada = {
        id,
        status: 'ACTIVE',
        value: corpo.value,
        cycle: corpo.cycle,
        billingType: corpo.billingType,
        nextDueDate: corpo.nextDueDate,
        externalReference: corpo.externalReference,
      }
      assinaturas.set(id, criada)
      return json(criada)
    }

    if (caminho === '/subscriptions' && metodo === 'GET') {
      const ref = url.searchParams.get('externalReference')
      return json({ data: [...assinaturas.values()].filter((a) => a.externalReference === ref) })
    }

    const uma = /^\/subscriptions\/([^/]+)$/.exec(caminho)
    if (uma && metodo === 'DELETE') {
      const assinatura = assinaturas.get(uma[1]!)
      if (assinatura === undefined) {
        return json({ errors: [{ code: 'not_found', description: 'nao existe' }] }, 404)
      }
      assinatura.status = 'INACTIVE'
      return json({ deleted: true, id: uma[1] })
    }

    return json({ errors: [{ code: 'not_found', description: caminho }] }, 404)
  }

  return { fetchFalso, assinaturas }
}

function provedor(extra: { fetchFalso?: typeof globalThis.fetch } = {}) {
  const { fetchFalso } = asaasFalso()
  return criarProvedorDeAssinaturaAsaas({
    ambiente: 'sandbox',
    apiKey: 'chave-da-conta-pai',
    webhookAuthToken: TOKEN,
    fetch: extra.fetchFalso ?? fetchFalso,
  })
}

verificarContratoDeAssinatura('asaas', () => provedor())

describe('adapter Asaas de assinatura — o que e proprio dele', () => {
  it('manda a recorrencia mensal, com valor decimal e o primeiro vencimento', async () => {
    const { fetchFalso } = asaasFalso()
    const corpos: Record<string, unknown>[] = []
    const espiao: typeof globalThis.fetch = async (entrada, init) => {
      if (init?.method === 'POST') {
        corpos.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      }
      return fetchFalso(entrada, init)
    }

    await provedor({ fetchFalso: espiao }).createSubscription(
      pedidoDeAssinatura({ amountCents: 8990 }),
    )

    /* 89.9 no corpo, e nao 8990: o Asaas fala decimal. */
    expect(corpos[0]).toMatchObject({
      cycle: 'MONTHLY',
      value: 89.9,
      nextDueDate: '2026-10-05',
    })
  })

  it('deixa o lojista escolher o meio de pagamento', async () => {
    const { fetchFalso } = asaasFalso()
    const corpos: Record<string, unknown>[] = []
    const espiao: typeof globalThis.fetch = async (entrada, init) => {
      if (init?.method === 'POST') {
        corpos.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      }
      return fetchFalso(entrada, init)
    }

    await provedor({ fetchFalso: espiao }).createSubscription(pedidoDeAssinatura())

    /* Fixar um meio aqui decidiria por ele: a DEC-010 fechou "mensalidade",
       nao "mensalidade no cartao". */
    expect(corpos[0]?.billingType).toBe('UNDEFINED')
  })

  it('manda a chave da conta-pai, e nao uma por empresa', async () => {
    const { fetchFalso } = asaasFalso()
    const chaves: string[] = []
    const espiao: typeof globalThis.fetch = async (entrada, init) => {
      chaves.push(String((init?.headers as Record<string, string>).access_token))
      return fetchFalso(entrada, init)
    }

    const p = provedor({ fetchFalso: espiao })
    await p.createSubscription(pedidoDeAssinatura())
    await p.createSubscription(pedidoDeAssinatura({ externalReference: 'assinatura-2' }))

    /* Resolver chave por empresa aqui cobraria a mensalidade na conta do
       proprio lojista. */
    expect(new Set(chaves)).toEqual(new Set(['chave-da-conta-pai']))
  })

  it('assinatura cancelada nao conta como "ja existe"', async () => {
    const { fetchFalso } = asaasFalso()
    const p = criarProvedorDeAssinaturaAsaas({
      ambiente: 'sandbox',
      apiKey: 'chave-da-conta-pai',
      webhookAuthToken: TOKEN,
      fetch: fetchFalso,
    })

    const primeira = await p.createSubscription(pedidoDeAssinatura())
    await p.cancelSubscription({
      companyId: 'empresa-1',
      providerSubscriptionId: primeira.providerSubscriptionId,
      reason: 'Lojista encerrou',
      requestedAt: '2026-09-19T13:00:00.000Z',
    })
    const segunda = await p.createSubscription(pedidoDeAssinatura())

    /* O lojista que encerrou e voltou precisa de uma recorrencia nova, nao da
       carcaca da antiga — que nao gera cobranca nenhuma. */
    expect(segunda.providerSubscriptionId).not.toBe(primeira.providerSubscriptionId)
  })

  it('erro de verdade no cancelamento LANCA, e 404 nao', async () => {
    const { fetchFalso } = asaasFalso()
    const quebrado: typeof globalThis.fetch = async (entrada, init) => {
      if (init?.method === 'DELETE') {
        return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })
      }
      return fetchFalso(entrada, init)
    }

    /* 500 e o provedor fora do ar: job para retentar, nao estado final. */
    await expect(
      provedor({ fetchFalso: quebrado }).cancelSubscription({
        companyId: 'empresa-1',
        providerSubscriptionId: 'sub_1',
        reason: 'x',
        requestedAt: '2026-09-19T13:00:00.000Z',
      }),
    ).rejects.toThrow(/cancelamento/i)
  })
})

describe('webhook da conta-pai — RNF-028', () => {
  const pagamentoDaMensalidade = JSON.stringify({
    id: 'evt_1',
    event: 'PAYMENT_CONFIRMED',
    dateCreated: '2026-10-05T12:00:00.000Z',
    payment: {
      id: 'pay_1',
      subscription: 'sub_1',
      value: 89.9,
      externalReference: 'assinatura-1',
    },
  })

  it('aceita com o token que cadastramos, e acha a assinatura pelo pagamento', () => {
    const r = provedor().readWebhook(pagamentoDaMensalidade, TOKEN)

    if (r.status !== 'accepted') throw new Error('esperava aceito')
    expect(r.event.type).toBe('subscription.paid')
    /* O aviso de PAGAMENTO carrega `payment.subscription`; o de ASSINATURA
       carrega `subscription.id`. */
    expect(r.event.providerSubscriptionId).toBe('sub_1')
    expect(r.event.amountCents).toBe(8990)
  })

  it('token errado NAO vira 200', () => {
    /* 200 ensinaria o atacante que o corpo foi aceito — e o corpo diz
       "mensalidade paga", que desbloqueia uma loja. */
    expect(provedor().readWebhook(pagamentoDaMensalidade, 'outro-token').status).toBe(
      'invalid_signature',
    )
  })

  it('sem token configurado recusa tudo', () => {
    const p = criarProvedorDeAssinaturaAsaas({
      ambiente: 'sandbox',
      apiKey: 'chave-da-conta-pai',
      fetch: async () => new Response('{}'),
    })

    /* Configuracao faltando nao pode virar porta aberta. */
    expect(p.readWebhook(pagamentoDaMensalidade, TOKEN).status).toBe('invalid_signature')
  })

  it('token de tamanho diferente recusa sem lancar', () => {
    /* `timingSafeEqual` lanca com buffers diferentes, e um throw viraria 500
       em vez de 401. */
    expect(() => provedor().readWebhook(pagamentoDaMensalidade, 'curto')).not.toThrow()
  })

  it('o cancelamento vem pelo evento de ASSINATURA', () => {
    const corpo = JSON.stringify({
      id: 'evt_2',
      event: 'SUBSCRIPTION_DELETED',
      dateCreated: '2026-11-01T12:00:00.000Z',
      subscription: { id: 'sub_1', value: 89.9, externalReference: 'assinatura-1' },
    })

    const r = provedor().readWebhook(corpo, TOKEN)

    if (r.status !== 'accepted') throw new Error('esperava aceito')
    expect([r.event.type, r.event.providerSubscriptionId]).toEqual([
      'subscription.cancelled',
      'sub_1',
    ])
  })

  it('cobranca GERADA nao e cobranca paga', () => {
    const corpo = JSON.stringify({
      id: 'evt_3',
      event: 'PAYMENT_CREATED',
      payment: { id: 'pay_2', subscription: 'sub_1', value: 89.9 },
    })

    /* Tratar como paga liberaria o acesso de quem so recebeu o boleto. */
    expect(provedor().readWebhook(corpo, TOKEN).status).toBe('ignored')
  })

  it('pagamento avulso da conta-pai e ignorado, e nao malformado', () => {
    const corpo = JSON.stringify({
      id: 'evt_4',
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_3', value: 50 },
    })

    /* Existe e e legitimo — so nao move assinatura nenhuma. Tratar como erro
       faria o Asaas reentregar para sempre um aviso que nunca vamos querer. */
    expect(provedor().readWebhook(corpo, TOKEN).status).toBe('ignored')
  })

  it('a recusa de pagamento carrega o motivo, para a tela dizer qual foi', () => {
    const corpo = JSON.stringify({
      id: 'evt_5',
      event: 'PAYMENT_OVERDUE',
      failureReason: 'Cartao sem limite.',
      payment: { id: 'pay_4', subscription: 'sub_1', value: 89.9 },
    })

    const r = provedor().readWebhook(corpo, TOKEN)

    if (r.status !== 'accepted') throw new Error('esperava aceito')
    /* RF-113: "pagamento recusado" sem o motivo deixa o lojista tentando o
       mesmo cartao de novo. */
    expect([r.event.type, r.event.failureReason]).toEqual([
      'subscription.payment_failed',
      'Cartao sem limite.',
    ])
  })

  it('corpo que nao e JSON responde malformed, e nao explode', () => {
    expect(provedor().readWebhook('nao sou json', TOKEN).status).toBe('malformed')
  })
})
