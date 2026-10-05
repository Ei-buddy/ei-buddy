import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * O lado de verdade de `vendas-api` — NR-042, RF-004, RF-036, RF-045, RF-054.
 *
 * ## O que estes testes guardam
 *
 * Ate aqui, nenhuma tela do celular oferecia emitir nota fiscal nem mostrava
 * historico de venda de verdade: as funcoes existiam (`emitirNota`,
 * `situacaoCertificado`) mas eram mock, e nenhum componente as chamava — a
 * venda ficava registrada, e so era possivel emitir nota e ver o historico
 * pelo computador.
 *
 * Os testes abaixo cobrem a traducao entre o vocabulario da api e o da tela,
 * porque e ali que um campo trocado passa despercebido: o TypeScript aceita
 * `p.method` como string solta na hora de montar `FORMA_DA_API`, e um valor
 * fora do mapa cairia num `undefined` silencioso sem um teste que o pegue.
 */

const chamadas: { caminho: string; opcoes?: unknown }[] = []
let resposta: { ok: boolean; dados?: unknown; status?: number; code?: string; message?: string }

vi.mock('./api', () => ({
  chamarApi: vi.fn((caminho: string, opcoes?: unknown) => {
    chamadas.push({ caminho, opcoes })
    return Promise.resolve(resposta)
  }),
}))

const {
  situacaoCertificado,
  pedirNota,
  estadoDaNota,
  reconciliarContingencia,
  listarHistoricoDeVendas,
} = await import('./vendas-api.js')

beforeEach(() => {
  chamadas.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('situacaoCertificado — RF-004', () => {
  /* O defeito que isto guarda: a versao anterior era `return 'ausente'` fixo,
     e a tela SEMPRE mandava cadastrar certificado, mesmo com um valido no
     banco — o botao de emitir nunca aparecia no celular. */
  it('ausente quando o servidor diz que nao ha certificado', async () => {
    resposta = { ok: true, dados: { hasCertificate: false, certificateExpiresAt: null } }

    expect(await situacaoCertificado()).toBe('ausente')
  })

  it('valido quando o certificado vence no futuro distante', async () => {
    resposta = { ok: true, dados: { hasCertificate: true, certificateExpiresAt: '2099-12-31' } }

    expect(await situacaoCertificado()).toBe('valido')
  })

  it('expirado quando o certificado venceu no passado distante', async () => {
    resposta = { ok: true, dados: { hasCertificate: true, certificateExpiresAt: '2000-01-01' } }

    expect(await situacaoCertificado()).toBe('expirado')
  })

  it('trata falha de rede como ausente, e nao como erro que trava a tela', async () => {
    resposta = { ok: false, status: 0, code: 'OFFLINE', message: 'Sem conexao.' }

    expect(await situacaoCertificado()).toBe('ausente')
  })

  it('consulta /empresa/credenciais-fiscais', async () => {
    resposta = { ok: true, dados: { hasCertificate: false, certificateExpiresAt: null } }

    await situacaoCertificado()

    expect(chamadas[0]?.caminho).toBe('/empresa/credenciais-fiscais')
  })
})

describe('pedirNota — RF-045', () => {
  it('pede a nota da venda pelo POST correto', async () => {
    resposta = { ok: true, dados: {} }

    const r = await pedirNota('ven-1')

    expect(r).toEqual({ ok: true })
    expect(chamadas[0]).toMatchObject({
      caminho: '/vendas/ven-1/nota',
      opcoes: { method: 'POST' },
    })
  })

  /* A recusa por classificacao (RF-046) chega com o NOME dos produtos que
     faltam — a mensagem precisa passar inteira, sem ser resumida aqui. */
  it('repassa a mensagem de recusa sem reescrever', async () => {
    resposta = {
      ok: false,
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Produto "Cafe" sem NCM cadastrado.',
    }

    const r = await pedirNota('ven-1')

    expect(r).toEqual({ ok: false, erro: 'Produto "Cafe" sem NCM cadastrado.' })
  })
})

describe('estadoDaNota — RF-054', () => {
  it('devolve o estado quando a api responde', async () => {
    resposta = {
      ok: true,
      dados: { status: 'authorized', accessKey: '123', number: 42, danfeUrl: 'https://x' },
    }

    expect(await estadoDaNota('ven-1')).toEqual({
      status: 'authorized',
      accessKey: '123',
      number: 42,
      danfeUrl: 'https://x',
    })
  })

  it('devolve null quando a consulta falha, e nao lanca', async () => {
    resposta = { ok: false, status: 500, code: 'ERROR', message: 'falhou' }

    expect(await estadoDaNota('ven-1')).toBeNull()
  })
})

describe('reconciliarContingencia — RF-053', () => {
  /* Atualizacao de fundo: falhar nela nao pode quebrar a tela que a chamou. */
  it('nao lanca quando a chamada falha', async () => {
    resposta = { ok: false, status: 500, code: 'ERROR', message: 'falhou' }

    await expect(reconciliarContingencia()).resolves.toBeUndefined()
  })

  it('chama o POST de reconciliacao', async () => {
    resposta = { ok: true, dados: {} }

    await reconciliarContingencia()

    expect(chamadas[0]).toMatchObject({
      caminho: '/vendas/notas/reconciliar',
      opcoes: { method: 'POST' },
    })
  })
})

describe('listarHistoricoDeVendas — RF-036, US-021', () => {
  const PAGINA = {
    total: 1,
    summary: {
      salesCount: 1,
      grossCents: 10000,
      netAfterFeesCents: 9200,
      averageTicketCents: 9500,
    },
  }
  const vendaDaApi = (over: Record<string, unknown> = {}) => ({
    id: 'ven-1',
    number: 1842,
    soldAt: '2026-09-10T14:00:00.000Z',
    customerName: 'Joana Ribeiro',
    status: 'settled',
    grossAmountCents: 10000,
    discountCents: 500,
    netAmountCents: 9200,
    taxAmountCents: 300,
    returnedAmountCents: 0,
    items: [
      {
        productId: 'p-1',
        description: 'Cafe 500g',
        quantity: 2,
        unitPriceCents: 5000,
        returnedQuantity: 0,
      },
    ],
    payments: [{ method: 'pix', amountCents: 9500 }],
    invoiceNumber: null,
    invoiceAccessKey: null,
    ...over,
  })

  it('converte centavos para reais e monta o total como bruto menos desconto', async () => {
    resposta = { ok: true, dados: { ...PAGINA, sales: [vendaDaApi()] } }

    const r = await listarHistoricoDeVendas()

    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.vendas[0]).toMatchObject({
      subtotal: 100,
      desconto: 5,
      total: 95,
      valorLiquido: 92,
      imposto: 3,
    })
  })

  it('traz a devolucao parcial por item e o resumo do servidor', async () => {
    resposta = {
      ok: true,
      dados: {
        ...PAGINA,
        sales: [
          vendaDaApi({
            returnedAmountCents: 4750,
            items: [
              {
                productId: 'p-1',
                description: 'Cafe 500g',
                quantity: 2,
                unitPriceCents: 5000,
                returnedQuantity: 1,
              },
            ],
          }),
        ],
      },
    }

    const r = await listarHistoricoDeVendas()

    if (!r.ok) throw new Error(r.erro)
    expect(r.vendas[0]).toMatchObject({ devolvidoValor: 47.5, status: 'concluida' })
    expect(r.vendas[0]?.itens[0]).toMatchObject({ produtoId: 'p-1', devolvido: 1 })
    expect(r.resumo).toEqual({ quantidade: 1, faturamento: 100, liquido: 92, ticketMedio: 95 })
  })

  /* Venda sem cliente identificado e caminho normal no balcao (RF-009): o
     rotulo tem de dizer isso, e nao deixar a linha sem contraparte. */
  it('cliente nulo vira "Venda sem cliente"', async () => {
    resposta = { ok: true, dados: { ...PAGINA, sales: [vendaDaApi({ customerName: null })] } }

    const r = await listarHistoricoDeVendas()

    expect(r.ok && r.vendas[0]?.clienteNome).toBe('Venda sem cliente')
  })

  it.each(['returned', 'cancelled'] as const)(
    'status "%s" da api vira "estornada" na tela',
    async (status) => {
      resposta = { ok: true, dados: { ...PAGINA, sales: [vendaDaApi({ status })] } }

      const r = await listarHistoricoDeVendas()

      expect(r.ok && r.vendas[0]?.status).toBe('estornada')
    },
  )

  it('status "open" e "settled" viram "concluida"', async () => {
    resposta = { ok: true, dados: { ...PAGINA, sales: [vendaDaApi({ status: 'open' })] } }

    const r = await listarHistoricoDeVendas()

    expect(r.ok && r.vendas[0]?.status).toBe('concluida')
  })

  it('sem nota fiscal, o campo nota fica nulo', async () => {
    resposta = { ok: true, dados: { ...PAGINA, sales: [vendaDaApi({ invoiceNumber: null })] } }

    const r = await listarHistoricoDeVendas()

    expect(r.ok && r.vendas[0]?.nota).toBeNull()
  })

  /* `nfse` nunca deve aparecer aqui: o emissor da loja so faz NFC-e (DEC-004),
     e mostrar "NFS-e" para uma nota que e sempre NFC-e enganaria a leitura. */
  it('com nota emitida, o tipo e sempre nfce', async () => {
    resposta = { ok: true, dados: { ...PAGINA, sales: [vendaDaApi({ invoiceNumber: 4187 })] } }

    const r = await listarHistoricoDeVendas()

    expect(r.ok && r.vendas[0]?.nota).toEqual({ tipo: 'nfce', numero: '4187' })
  })

  it('traduz a forma de pagamento do vocabulario da api para o da tela', async () => {
    resposta = {
      ok: true,
      dados: {
        ...PAGINA,
        sales: [
          vendaDaApi({
            payments: [
              { method: 'cash', amountCents: 1000 },
              { method: 'credit', amountCents: 2000 },
            ],
          }),
        ],
      },
    }

    const r = await listarHistoricoDeVendas()

    expect(r.ok && r.vendas[0]?.pagamentos).toEqual([
      { forma: 'dinheiro', valor: 10 },
      { forma: 'credito', valor: 20 },
    ])
  })

  it('repassa o erro quando a api falha, em vez de lancar', async () => {
    resposta = { ok: false, status: 500, code: 'ERROR', message: 'Sem conexao.' }

    const r = await listarHistoricoDeVendas()

    expect(r).toEqual({ ok: false, erro: 'Sem conexao.' })
  })
})
