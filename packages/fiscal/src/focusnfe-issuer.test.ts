import { describe, expect, it } from 'vitest'
import {
  criarEmissorFocusNfe,
  type CredenciaisFocusNfe,
  reaisDeCentavos,
} from './focusnfe-issuer.js'
import { InMemoryInvoiceStore } from './invoice-store.js'
import { pedidoValido, verificarContratoDoEmissor } from './invoice-issuer-contract.js'

/**
 * O adapter Focus NFe — NR-042, DEC-004.
 *
 * Passa pela MESMA suite de contrato do falso: e a promessa de que os dois sao
 * substituiveis. O que o falso simula, aqui e simulado no lugar certo — na
 * fronteira HTTP, e nao dentro do adapter. Um teste que trocasse o adapter por
 * um objeto amigavel provaria que o teste funciona, e nada sobre o adapter.
 */

const TOKEN = 'tok-empresa-1'
const CNPJ = '11222333000181'

const credenciais: CredenciaisFocusNfe = {
  tokenDe: async (companyId) => (companyId === 'empresa-3' ? undefined : `${TOKEN}-${companyId}`),
  cnpjDe: async (companyId) => (companyId === 'empresa-3' ? undefined : CNPJ),
}

/**
 * Um Focus NFe de mentira, com o comportamento que a documentacao descreve.
 *
 * Numera em sequencia POR SERIE e por token, como o provedor faz quando nao se
 * informa `numero`. E recusa reusar `ref` de nota ja autorizada — a regra que
 * da metade da idempotencia.
 */
function focusDeMentira(
  configurar: {
    rejeitarCom?: { status_sefaz: string; mensagem_sefaz: string }
    contingencia?: boolean
    /** A SEFAZ denegou: irregularidade cadastral, e o numero foi consumido. */
    denegar?: boolean
    /** O GET devolve uma nota ja cancelada. */
    consultaCancelada?: boolean
    corpoIlegivel?: boolean
    semChave?: boolean
    cancelamentoSemProtocolo?: boolean
  } = {},
) {
  const emitidas = new Map<string, { numero: number; serie: number; chave: string }>()
  const proximoNumero = new Map<string, number>()
  const chamadas: { url: string; method: string; authorization: string; body: unknown }[] = []

  const fetchFalso = (async (url: string | URL, init?: RequestInit) => {
    const endereco = String(url)
    const method = init?.method ?? 'GET'
    const corpoEnviado = init?.body === undefined ? undefined : JSON.parse(String(init.body))

    chamadas.push({
      url: endereco,
      method,
      authorization: String((init?.headers as Record<string, string>)?.authorization ?? ''),
      body: corpoEnviado,
    })

    const responder = (status: number, corpo: unknown) =>
      ({
        status,
        ok: status < 400,
        text: async () =>
          configurar.corpoIlegivel === true ? '<html>502</html>' : JSON.stringify(corpo),
      }) as Response

    if (method === 'POST') {
      const ref = new URL(endereco).searchParams.get('ref') ?? ''

      if (emitidas.has(ref)) {
        /* O provedor recusa reusar referencia de nota autorizada. */
        return responder(422, {
          codigo: 'ref_ja_utilizada',
          mensagem: 'Referencia ja utilizada por outra nota autorizada.',
        })
      }

      if (configurar.rejeitarCom !== undefined) {
        return responder(422, { status: 'erro_autorizacao', ...configurar.rejeitarCom })
      }

      if (configurar.denegar === true) {
        return responder(200, {
          status: 'denegado',
          status_sefaz: '302',
          mensagem_sefaz: 'Rejeicao: Irregularidade fiscal do destinatario.',
        })
      }

      const serie = Number(corpoEnviado?.serie ?? 1)
      /* Por SERIE, e nao por requisicao: cada nota da serie recebe o proximo
         numero, como o provedor faz quando nao se informa `numero`. */
      const chaveDaSerie = String(serie)
      const numero = (proximoNumero.get(chaveDaSerie) ?? 0) + 1
      proximoNumero.set(chaveDaSerie, numero)

      const chave = String(numero).padStart(44, '4')
      emitidas.set(ref, { numero, serie, chave })

      return responder(200, {
        status: 'autorizado',
        chave_nfe: configurar.semChave === true ? undefined : chave,
        numero,
        serie,
        caminho_xml_nota_fiscal: `/arquivos/${chave}.xml`,
        caminho_danfe: `/danfe/${chave}.html`,
        ...(configurar.contingencia === true
          ? { contingencia_offline: true, mensagem_sefaz: 'SEFAZ fora do ar' }
          : {}),
      })
    }

    /* GET /nfce/{ref} — consulta. */
    if (method === 'GET') {
      const refConsultada = endereco.split('/').pop() ?? ''
      if (configurar.consultaCancelada === true) {
        return responder(200, {
          status: 'cancelado',
          numero_protocolo: 'PROT-CANCEL',
          caminho_xml_cancelamento: '/arquivos/cancelamento.xml',
        })
      }
      const nota = emitidas.get(refConsultada)
      if (nota === undefined) {
        return responder(404, { codigo: 'nao_encontrada', mensagem: 'Nota nao encontrada.' })
      }
      return responder(200, {
        status: 'autorizado',
        chave_nfe: nota.chave,
        numero: nota.numero,
        serie: nota.serie,
        caminho_xml_nota_fiscal: `/arquivos/${nota.chave}.xml`,
        caminho_danfe: `/danfe/${nota.chave}.html`,
      })
    }

    /* DELETE /nfce/{ref} */
    const ref = endereco.split('/').pop() ?? ''
    if (!emitidas.has(ref)) {
      return responder(404, { codigo: 'nao_encontrada', mensagem: 'Nota nao encontrada.' })
    }

    const justificativa = String(corpoEnviado?.justificativa ?? '')
    if (justificativa.length < 15) {
      return responder(422, {
        status: 'erro_cancelamento',
        status_sefaz: '999',
        mensagem_sefaz: 'Justificativa deve ter ao menos 15 caracteres.',
      })
    }

    return responder(200, {
      status: 'cancelado',
      numero_protocolo: configurar.cancelamentoSemProtocolo === true ? undefined : `PROT-${ref}`,
      caminho_xml_cancelamento: `/arquivos/cancelamento-${ref}.xml`,
    })
  }) as unknown as typeof globalThis.fetch

  return { fetch: fetchFalso, chamadas }
}

function emissor(configurar: Parameters<typeof focusDeMentira>[0] = {}) {
  const focus = focusDeMentira(configurar)
  return {
    focus,
    emissor: criarEmissorFocusNfe({
      ambiente: 'homologacao',
      credenciais,
      store: new InMemoryInvoiceStore(),
      fetch: focus.fetch,
    }),
  }
}

/* A prova de substituibilidade: a mesma suite que o falso passa. */
verificarContratoDoEmissor('Focus NFe (provedor simulado)', () => emissor().emissor)

describe('o que so o adapter Focus NFe faz', () => {
  it('autentica com Basic e senha VAZIA', async () => {
    const c = emissor()

    await c.emissor.issue(pedidoValido())

    /*
     * `Base64("token:")` — os dois pontos sem nada depois sao intencionais e
     * estao na documentacao. Omiti-los muda o token, e a falha vem com uma
     * mensagem que nao explica nada.
     */
    const esperado = `Basic ${Buffer.from(`${TOKEN}-empresa-1:`, 'utf8').toString('base64')}`
    expect(c.focus.chamadas[0]?.authorization).toBe(esperado)
  })

  it('manda a venda como `ref` na query, so com letras e numeros', async () => {
    const c = emissor()

    await c.emissor.issue(pedidoValido({ saleId: 'venda-77' }))

    /* A referencia e o que amarra a nota a venda no lado do provedor, e e o que
       permite cancelar depois. */
    expect(c.focus.chamadas[0]?.url).toContain('ref=venda77')
  })

  it('nao transmite a segunda vez: a guarda responde antes da rede', async () => {
    const c = emissor()

    const primeira = await c.emissor.issue(pedidoValido())
    const segunda = await c.emissor.issue(pedidoValido())

    /*
     * Nota duplicada e problema fiscal, nao inconveniencia. O provedor tambem
     * recusaria, mas como ERRO — e uma chamada gasta para descobrir algo que a
     * guarda ja sabia.
     */
    expect(segunda).toEqual(primeira)
    expect(c.focus.chamadas).toHaveLength(1)
  })

  it('converte centavos sem passar por ponto flutuante', () => {
    /* `1990 / 100` da 19.9, mas `1_00_00_00_07 / 100` e vizinhos produzem
       dizima em binario. Um centavo a mais numa nota e divergencia com a
       SEFAZ. */
    expect(reaisDeCentavos(1990)).toBe('19.90')
    expect(reaisDeCentavos(7)).toBe('0.07')
    expect(reaisDeCentavos(100000007)).toBe('1000000.07')
    expect(reaisDeCentavos(0)).toBe('0.00')
  })

  it('manda valores como string decimal, no formato da SEFAZ', async () => {
    const c = emissor()

    await c.emissor.issue(pedidoValido())

    const corpo = c.focus.chamadas[0]?.body as { items: { valor_bruto: string }[] }
    expect(corpo.items[0]?.valor_bruto).toMatch(/^\d+\.\d{2}$/)
  })

  it('contingencia offline volta como `contingency`, e nao como autorizada', async () => {
    const c = emissor({ contingencia: true })

    const r = await c.emissor.issue(pedidoValido())

    /*
     * RF-052: a venda nao pode ser bloqueada pela SEFAZ fora do ar. E o estado
     * precisa ser DISTINTO de autorizada (RF-054) — em contingencia a nota tem
     * chave e ainda nao tem protocolo, e alguem precisa retransmitir depois.
     */
    expect(r.status).toBe('contingency')
    if (r.status === 'contingency') {
      expect(r.accessKey).toHaveLength(44)
      expect(r.reason).toContain('SEFAZ')
    }
  })

  it('`autorizado` sem chave vira rejeicao, e nao nota sem chave', async () => {
    const c = emissor({ semChave: true })

    const r = await c.emissor.issue(pedidoValido())

    /*
     * Aceitar produziria uma nota sem chave, que a constraint do banco recusa —
     * DEPOIS de a SEFAZ ter autorizado. E a pior ordem possivel: o documento
     * existe no mundo e nao existe aqui.
     */
    expect(r.status).toBe('rejected')
    if (r.status === 'rejected') expect(r.rejection.code).toBe('FOCUS-RESPOSTA-INCOMPLETA')
  })

  it('corpo ilegivel LANCA, porque e infraestrutura e o job deve retentar', async () => {
    const c = emissor({ corpoIlegivel: true })

    /*
     * A porta e explicita: so infraestrutura lanca. "O provedor respondeu HTML
     * de erro" e isso. Traduzir para rejeicao faria o job desistir de uma nota
     * que talvez tenha sido autorizada do outro lado.
     */
    await expect(c.emissor.issue(pedidoValido())).rejects.toThrow(/ilegivel/i)
  })

  it('empresa sem emissao habilitada lanca, em vez de rejeitar a nota', async () => {
    const c = emissor()

    /* Falta de credencial e configuracao, nao recusa da SEFAZ. Devolver
       "rejeitada" mandaria o lojista procurar erro no cadastro do produto. */
    await expect(c.emissor.issue(pedidoValido({ companyId: 'empresa-3' }))).rejects.toThrow(
      /emissao fiscal/i,
    )
  })

  it('cancelamento sem protocolo vira rejeicao', async () => {
    const c = emissor({ cancelamentoSemProtocolo: true })
    const emitida = await c.emissor.issue(pedidoValido())
    if (emitida.status !== 'authorized') throw new Error('esperava nota autorizada')

    const r = await c.emissor.cancel({
      companyId: 'empresa-1',
      accessKey: emitida.accessKey,
      reason: 'Cliente desistiu da compra no balcao',
      requestedAt: '2026-09-02T13:10:00.000Z',
    })

    /*
     * O protocolo e a prova perante a SEFAZ. Sem ele o lojista teria uma nota
     * marcada como cancelada e nada para mostrar numa fiscalizacao.
     */
    expect(r.status).toBe('rejected')
    if (r.status === 'rejected') expect(r.rejection.code).toBe('FOCUS-CANCELAMENTO-SEM-PROTOCOLO')
  })

  it('cancela pela REFERENCIA da venda, e nao pela chave', async () => {
    const c = emissor()
    const emitida = await c.emissor.issue(pedidoValido({ saleId: 'venda-88' }))
    if (emitida.status !== 'authorized') throw new Error('esperava nota autorizada')

    await c.emissor.cancel({
      companyId: 'empresa-1',
      accessKey: emitida.accessKey,
      reason: 'Cliente desistiu da compra no balcao',
      requestedAt: '2026-09-02T13:10:00.000Z',
    })

    /* E por isto que a guarda existe: a porta fala chave, o provedor fala
       referencia, e nao ha endpoint que traduza. */
    const cancelamento = c.focus.chamadas.find((ch) => ch.method === 'DELETE')
    expect(cancelamento?.url).toContain('/nfce/venda88')
  })
})

describe('os cinco status que a SEFAZ devolve — RF-047', () => {
  it('denegada NAO e recusada: o numero foi consumido, e a mensagem diz isso', async () => {
    const e = emissor({ denegar: true })

    const r = await e.emissor.issue(pedidoValido())

    expect(r.status).toBe('rejected')
    if (r.status !== 'rejected') return

    expect(r.rejection.code).toBe('302')
    /*
     * A diferenca que custa dinheiro: rejeicao comum deixa o numero livre e
     * reenviar resolve; denegacao consome o numero e reenviar nunca vai passar.
     * Mandar o lojista "tentar de novo" numa denegacao e mande-lo repetir uma
     * operacao impossivel em vez de regularizar o cadastro.
     */
    expect(r.rejection.message).toContain('numero foi consumido')
    expect(r.rejection.message).toContain('Regularize')
  })

  it('consulta de nota ja cancelada nao volta como rejeitada', async () => {
    const e = emissor({ consultaCancelada: true })

    const r = await e.emissor.consult?.({ companyId: 'empresa-1', saleId: 'venda-1' })

    /*
     * `undefined` e "esta venda nao tem nota valendo". Como `rejected`, a
     * reconciliacao de contingencia (RF-053) TRAVARIA: o laco para na primeira
     * nao autorizada, e uma cancelada ficaria ali para sempre, impedindo todas
     * as posteriores de serem reconhecidas.
     */
    expect(r).toBeUndefined()
  })

  it('consulta devolve a nota autorizada quando ela existe', async () => {
    const e = emissor()
    await e.emissor.issue(pedidoValido())

    const r = await e.emissor.consult?.({ companyId: 'empresa-1', saleId: pedidoValido().saleId })

    expect(r?.status).toBe('authorized')
  })

  it('consulta de referencia desconhecida volta indefinida, e nao erro', async () => {
    const e = emissor()

    const r = await e.emissor.consult?.({ companyId: 'empresa-1', saleId: 'venda-que-nao-existe' })

    expect(r).toBeUndefined()
  })
})
