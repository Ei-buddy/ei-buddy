import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { criarGatewayAsaas, type CredenciaisAsaas } from './asaas-gateway.js'
import {
  pedidoDeBoleto,
  pedidoDeCartao,
  pedidoDeLink,
  pedidoDePix,
  pedidoDeToken,
  verificarContratoDoGateway,
} from './payment-gateway-contract.js'

/**
 * O adapter do Asaas contra um Asaas falso — NR-044.
 *
 * O falso vive AQUI e nao em `src`: ele nao e produto, e um duble de teste. O
 * que ele imita e a forma da API (caminhos, campos, decimal no valor), nao a
 * regra de negocio dela.
 *
 * ## Por que uma chave por empresa no duble
 *
 * No Asaas de verdade cada loja e uma SUBCONTA com chave propria, e a cobranca
 * de uma loja simplesmente nao existe para a chave da outra. O duble guarda
 * por chave pelo mesmo motivo — e e isso que faz o teste de isolamento do
 * contrato valer alguma coisa aqui. Um duble com armazenamento unico passaria
 * o teste por acaso, so porque o adapter manda `companyId`.
 */

const SEGREDO = 'segredo-do-webhook'

function asaasFalso() {
  /* chave da subconta -> cobrancas daquela loja */
  const porChave = new Map<string, Map<string, Record<string, unknown>>>()
  let sequencia = 0

  const cobrancas = (chave: string) => {
    const atual = porChave.get(chave) ?? new Map<string, Record<string, unknown>>()
    porChave.set(chave, atual)
    return atual
  }

  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

  const fetchFalso: typeof globalThis.fetch = async (entrada, init) => {
    const url = new URL(String(entrada))
    const caminho = url.pathname.replace('/v3', '')
    const metodo = init?.method ?? 'GET'
    const chave = String((init?.headers as Record<string, string>).access_token)
    const corpo =
      init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>)
    const minhas = cobrancas(chave)

    if (caminho === '/payments' && metodo === 'POST') {
      sequencia += 1
      const id = `pay_${sequencia}`
      const criada = {
        id,
        status: 'PENDING',
        value: corpo.value,
        billingType: corpo.billingType,
        externalReference: corpo.externalReference,
        ...(corpo.billingType === 'BOLETO'
          ? { dueDate: corpo.dueDate, bankSlipUrl: `https://www.asaas.com/b/pdf/${id}` }
          : {}),
        ...(corpo.billingType === 'CREDIT_CARD'
          ? {
              status: 'CONFIRMED',
              /* No parcelado o Asaas devolve `value` = PARCELA e `totalValue` =
                 total. O duble reproduz isso para o adapter nao poder confiar
                 em `value` sem perceber. */
              value: Number(corpo.totalValue) / Number(corpo.installmentCount ?? 1),
              totalValue: corpo.totalValue,
              installmentCount: corpo.installmentCount,
              creditCard: { creditCardNumber: '1111', creditCardBrand: 'VISA' },
            }
          : {}),
      }
      minhas.set(id, criada)
      return json(criada)
    }

    if (caminho === '/payments' && metodo === 'GET') {
      const ref = url.searchParams.get('externalReference')
      const achadas = [...minhas.values()].filter((c) => c.externalReference === ref)
      return json({ data: achadas })
    }

    const linhaDoBoleto = /^\/payments\/([^/]+)\/identificationField$/.exec(caminho)
    if (linhaDoBoleto) {
      const cobranca = minhas.get(linhaDoBoleto[1]!)
      if (cobranca === undefined || cobranca.billingType !== 'BOLETO') {
        return json({ errors: [{ code: 'invalid_action', description: 'nao e boleto' }] }, 400)
      }
      /* Formatada, com pontos e espacos — e assim que ela chega de verdade, e
         normalizar isso e trabalho do adapter. */
      return json({
        identificationField: '34191.09008 61713.957308 71444.640008 5 84400000002000',
        barCode: '34195844000000020000900086171395730714446400',
        nossoNumero: '08561713',
      })
    }

    const pixQr = /^\/payments\/([^/]+)\/pixQrCode$/.exec(caminho)
    if (pixQr) {
      return minhas.has(pixQr[1]!)
        ? json({ payload: `00020126580014BR.GOV.BCB.PIX-${pixQr[1]}`, encodedImage: 'x' })
        : json({ errors: [{ code: 'not_found', description: 'nao existe' }] }, 404)
    }

    const estorno = /^\/payments\/([^/]+)\/refund$/.exec(caminho)
    if (estorno && metodo === 'POST') {
      const cobranca = minhas.get(estorno[1]!)
      /* O Asaas recusa estorno de cobranca nao paga — e o contrato exige que
         isso seja RESULTADO, nao excecao. */
      if (cobranca === undefined || cobranca.status !== 'RECEIVED') {
        return json(
          { errors: [{ code: 'invalid_action', description: 'Cobranca ainda nao foi paga.' }] },
          400,
        )
      }
      return json({ id: `ref_${estorno[1]}`, value: cobranca.value })
    }

    const uma = /^\/payments\/([^/]+)$/.exec(caminho)
    if (uma && metodo === 'GET') {
      const cobranca = minhas.get(uma[1]!)
      return cobranca === undefined
        ? json({ errors: [{ code: 'not_found', description: 'nao existe' }] }, 404)
        : json(cobranca)
    }

    if (caminho === '/creditCard/tokenizeCreditCard' && metodo === 'POST') {
      const cartao = (corpo.creditCard ?? {}) as Record<string, unknown>
      const numero = String(cartao.number ?? '')
      /* O Asaas recusa numero com espaco. O duble tambem, porque e por isso
         que o adapter normaliza antes de mandar. */
      if (!/^[0-9]+$/.test(numero)) {
        return json(
          { errors: [{ code: 'invalid_creditCard', description: 'numero invalido' }] },
          400,
        )
      }
      sequencia += 1
      return json({
        creditCardNumber: numero.slice(-4),
        creditCardBrand: 'VISA',
        creditCardToken: `tok_${sequencia}`,
      })
    }

    if (caminho === '/paymentLinks' && metodo === 'POST') {
      sequencia += 1
      return json({
        id: `link_${sequencia}`,
        url: `https://www.asaas.com/c/link_${sequencia}`,
        value: corpo.value,
      })
    }

    if (caminho === '/myAccount/fees/') {
      return json({ creditCard: { operationValue: 2.99, upToSixInstallmentsPercentage: 3.49 } })
    }

    return json({ errors: [{ code: 'not_found', description: caminho }] }, 404)
  }

  return {
    fetchFalso,
    marcarPaga: (chave: string, id: string) => {
      const c = cobrancas(chave).get(id)
      if (c) c.status = 'RECEIVED'
    },
  }
}

/** Cada empresa com a chave da sua subconta — como no Asaas de verdade. */
const credenciais: CredenciaisAsaas = {
  apiKeyDaEmpresa: async (companyId) => `chave_${companyId}`,
}

function gateway(extra: { fetchFalso?: typeof globalThis.fetch } = {}) {
  const { fetchFalso } = asaasFalso()
  return criarGatewayAsaas({
    ambiente: 'sandbox',
    credenciais,
    webhookSecret: SEGREDO,
    fetch: extra.fetchFalso ?? fetchFalso,
  })
}

verificarContratoDoGateway('asaas', () => gateway())

describe('adapter Asaas — o que e proprio dele', () => {
  it('converte centavo para decimal no corpo, e decimal de volta para centavo', async () => {
    const { fetchFalso } = asaasFalso()
    const enviados: unknown[] = []
    const espiao: typeof globalThis.fetch = async (entrada, init) => {
      if (init?.body !== undefined) enviados.push(JSON.parse(String(init.body)))
      return fetchFalso(entrada, init)
    }

    const cobranca = await gateway({ fetchFalso: espiao }).createPixCharge(
      pedidoDePix({ amountCents: 12990 }),
    )

    /* 129.9 no corpo, 12990 na volta. O arredondamento e o ponto: 129.9 * 100
       da 12989.999... em ponto flutuante. */
    expect(enviados[0]).toMatchObject({ value: 129.9 })
    expect(cobranca.amountCents).toBe(12990)
  })

  it('nasce pendente mesmo que o provedor ja diga outra coisa depois', async () => {
    const cobranca = await gateway().createPixCharge(pedidoDePix())
    expect(cobranca.status).toBe('pending')
  })

  it('loja sem conta no Asaas falha dizendo isso, sem chamar a API', async () => {
    let chamou = false
    const g = criarGatewayAsaas({
      ambiente: 'sandbox',
      credenciais: { apiKeyDaEmpresa: async () => undefined },
      fetch: async () => {
        chamou = true
        return new Response('{}')
      },
    })

    await expect(g.createPixCharge(pedidoDePix())).rejects.toThrow(/conta de recebimento/i)
    expect(chamou).toBe(false)
  })

  it('link de pagamento devolve URL https e o vencimento pedido', async () => {
    const link = await gateway().createPaymentLink(pedidoDeLink())
    expect(link.url).toMatch(/^https:\/\//)
    expect(link.dueDate).toBe('2026-09-10')
  })
})

describe('webhook do Asaas — RNF-028', () => {
  const corpo = JSON.stringify({
    id: 'evt_1',
    event: 'PAYMENT_RECEIVED',
    dateCreated: '2026-09-19T12:00:00.000Z',
    payment: { id: 'pay_1', value: 129.9, externalReference: 'ref-1' },
  })
  const assinar = (texto: string, segredo = SEGREDO) =>
    createHmac('sha256', segredo).update(texto, 'utf8').digest('hex')

  it('aceita evento com assinatura valida e traduz para o nosso vocabulario', () => {
    const r = gateway().readWebhook(corpo, assinar(corpo))

    expect(r.status).toBe('accepted')
    if (r.status !== 'accepted') return
    expect(r.event.type).toBe('payment.authorized')
    expect(r.event.chargeId).toBe('pay_1')
    expect(r.event.amountCents).toBe(12990)
  })

  it('assinatura errada NAO vira 200 — recusa explicita', () => {
    expect(gateway().readWebhook(corpo, assinar(corpo, 'outro-segredo')).status).toBe(
      'invalid_signature',
    )
  })

  /* O HMAC e sobre os BYTES que chegaram: um espaco a mais ja muda a
     assinatura, e reserializar depois de parsear quebraria a conferencia. */
  it('corpo alterado depois de assinado e recusado', () => {
    const adulterado = corpo.replace('129.9', '1299.9')
    expect(gateway().readWebhook(adulterado, assinar(corpo)).status).toBe('invalid_signature')
  })

  /* Configuracao faltando nao pode virar porta aberta: sem segredo, qualquer
     um postaria "pagamento recebido" e o titulo baixaria sozinho. */
  it('sem segredo configurado recusa tudo, em vez de aceitar sem conferir', () => {
    const g = criarGatewayAsaas({
      ambiente: 'sandbox',
      credenciais,
      fetch: async () => new Response('{}'),
    })
    expect(g.readWebhook(corpo, assinar(corpo)).status).toBe('invalid_signature')
  })

  it('evento que nao interessa e ignorado, nao tratado como erro', () => {
    const outro = JSON.stringify({
      id: 'evt_2',
      event: 'PAYMENT_UPDATED',
      payment: { id: 'pay_1' },
    })
    expect(gateway().readWebhook(outro, assinar(outro)).status).toBe('ignored')
  })

  it('corpo que nao e JSON responde malformed, nao explode', () => {
    const lixo = 'nao sou json'
    expect(gateway().readWebhook(lixo, assinar(lixo)).status).toBe('malformed')
  })
})

describe('cotacao de tarifa — RNF-003', () => {
  it('cota com bandeira unknown, porque a tarifa do Asaas e da conta', async () => {
    const r = await gateway().fetchFeeQuotes({
      companyId: 'emp-1',
      requestedAt: '2026-09-19T12:00:00.000Z',
    })

    expect(r.status).toBe('quoted')
    if (r.status !== 'quoted') return
    /* Repetir a mesma taxa sob cinco bandeiras daria a impressao de cinco
       medidas independentes. */
    expect(r.quotes.every((q) => q.brand === 'unknown')).toBe(true)
    expect(r.quotes[0]?.feeRatePercent).toBe(2.99)
  })

  it('provedor fora do ar e resposta esperada, nao excecao', async () => {
    const g = criarGatewayAsaas({
      ambiente: 'sandbox',
      credenciais,
      fetch: async () => new Response('{}', { status: 503 }),
    })

    const r = await g.fetchFeeQuotes({
      companyId: 'emp-1',
      requestedAt: '2026-09-19T12:00:00.000Z',
    })
    expect(r.status).toBe('unavailable')
  })
})

describe('boleto no Asaas — NR-044', () => {
  it('normaliza a linha digitavel formatada que o provedor devolve', async () => {
    const boleto = await gateway().createBoletoCharge(pedidoDeBoleto())

    /* O provedor manda '34191.09008 61713.957308 …'. Pontuacao e apresentacao:
       quem compara ou grava quer os 47 digitos. */
    expect(boleto.digitableLine).toBe('34191090086171395730871444640008584400000002000')
    expect(boleto.pdfUrl).toBe(`https://www.asaas.com/b/pdf/${boleto.chargeId}`)
  })

  it('manda o vencimento pedido, e nao a data de hoje', async () => {
    const { fetchFalso } = asaasFalso()
    const corpos: Record<string, unknown>[] = []
    const espiao: typeof globalThis.fetch = async (entrada, init) => {
      if (init?.method === 'POST' && String(entrada).endsWith('/payments')) {
        corpos.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      }
      return fetchFalso(entrada, init)
    }

    await gateway({ fetchFalso: espiao }).createBoletoCharge(
      pedidoDeBoleto({ dueDate: '2026-10-05' }),
    )

    /* No boleto o vencimento e impresso no documento: errar aqui e o cliente
       recebendo um titulo com prazo que o lojista nao combinou. */
    expect(corpos[0]?.billingType).toBe('BOLETO')
    expect(corpos[0]?.dueDate).toBe('2026-10-05')
  })

  it('lanca quando o provedor nao devolve linha digitavel', async () => {
    const { fetchFalso } = asaasFalso()
    const semLinha: typeof globalThis.fetch = async (entrada, init) => {
      if (String(entrada).includes('/identificationField')) {
        return new Response(JSON.stringify({ errors: [{ code: 'x', description: 'fora' }] }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      return fetchFalso(entrada, init)
    }

    /* Boleto pela metade nao e boleto: sem a linha, a tela mostraria um campo
       vazio no lugar do unico dado que o cliente precisa digitar. */
    await expect(
      gateway({ fetchFalso: semLinha }).createBoletoCharge(pedidoDeBoleto()),
    ).rejects.toThrow(/linha digitavel/i)
  })
})

describe('cartao no Asaas — NR-044', () => {
  it('normaliza o numero antes de mandar, e nao devolve o PAN', async () => {
    const token = await gateway().tokenizeCard(pedidoDeToken({ number: '4111 1111 1111 1111' }))

    /* O formulario entrega com espaco; a rede tem de ver digito puro. */
    expect(token.token).toMatch(/^tok_/)
    expect(token.last4).toBe('1111')
    expect(JSON.stringify(token)).not.toContain('4111111111111111')
  })

  it('manda totalValue e installmentCount, nunca o total no campo da parcela', async () => {
    const { fetchFalso } = asaasFalso()
    const corpos: Record<string, unknown>[] = []
    const espiao: typeof globalThis.fetch = async (entrada, init) => {
      if (init?.method === 'POST' && String(entrada).endsWith('/payments')) {
        corpos.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      }
      return fetchFalso(entrada, init)
    }

    await gateway({ fetchFalso: espiao }).createCardCharge(
      pedidoDeCartao({ amountCents: 24000, installments: 3 }),
    )

    /* `value` no Asaas e o valor da PARCELA: mandar 240,00 ali cobraria
       3 x R$ 240,00 do cliente. */
    expect(corpos[0]?.totalValue).toBe(240)
    expect(corpos[0]?.installmentCount).toBe(3)
    expect(corpos[0]?.value).toBeUndefined()
  })

  it('recusa da operadora volta como resultado, nao como excecao', async () => {
    const { fetchFalso } = asaasFalso()
    const recusa: typeof globalThis.fetch = async (entrada, init) => {
      if (init?.method === 'POST' && String(entrada).endsWith('/payments')) {
        return new Response(
          JSON.stringify({
            errors: [{ code: 'invalid_credit_card', description: 'Cartao sem limite.' }],
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }
      return fetchFalso(entrada, init)
    }

    const r = await gateway({ fetchFalso: recusa }).createCardCharge(pedidoDeCartao())

    /* O lojista precisa ler a razao para decidir entre outro cartao e outro
       meio — um throw viraria "erro inesperado" na tela. */
    if (r.status !== 'declined') throw new Error('esperava recusa')
    expect(r.decline.message).toMatch(/limite/i)
  })

  it('traduz a bandeira do provedor, e o desconhecido fica unknown', async () => {
    const { fetchFalso } = asaasFalso()
    const outraBandeira: typeof globalThis.fetch = async (entrada, init) => {
      if (String(entrada).includes('/creditCard/tokenizeCreditCard')) {
        return new Response(
          JSON.stringify({
            creditCardNumber: '4321',
            creditCardBrand: 'JCB',
            creditCardToken: 'tok_jcb',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return fetchFalso(entrada, init)
    }

    const token = await gateway({ fetchFalso: outraBandeira }).tokenizeCard(pedidoDeToken())

    /* Escrever a bandeira errada faz o lojista procurar um cartao que o
       cliente nao usou. */
    expect(token.brand).toBe('unknown')
  })
})
