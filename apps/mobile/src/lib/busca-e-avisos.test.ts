import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Busca global, sino de avisos e grafico da semana do app — NR-162 e NR-161.
 *
 * O que estes testes guardam e a TRADUCAO: cada resultado e cada aviso tem de
 * levar a tela certa com o filtro certo, e uma leitura que falha nao pode
 * derrubar as outras nem virar um numero inventado.
 */

let respostas: Record<string, { ok: boolean; dados?: unknown; message?: string }> = {}
const chamadas: string[] = []

vi.mock('./api', () => ({
  chamarApi: vi.fn((caminho: string) => {
    chamadas.push(caminho)
    const chave = Object.keys(respostas).find((k) => caminho.startsWith(k))
    return Promise.resolve(
      chave === undefined ? { ok: false, message: 'sem resposta' } : respostas[chave],
    )
  }),
}))

const armazem = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((k: string) => Promise.resolve(armazem.get(k) ?? null)),
    setItem: vi.fn((k: string, v: string) => {
      armazem.set(k, v)
      return Promise.resolve()
    }),
  },
}))

const { buscarTudo } = await import('./busca-api.js')
const { carregarAvisos, avisosNovos, lerAvisosVistos, marcarAvisosVistos } =
  await import('./avisos-api.js')
const { carregarSemana } = await import('./inicio-api.js')

beforeEach(() => {
  respostas = {}
  chamadas.length = 0
  armazem.clear()
})

describe('busca global — NR-162', () => {
  it('leva cada resultado a tela certa', async () => {
    respostas = {
      '/produtos/catalogo': {
        ok: true,
        dados: {
          products: [
            { id: 'p1', description: 'Arroz', internalCode: 'PROD-1', salePriceCents: 2800 },
          ],
        },
      },
      '/clientes': {
        ok: true,
        dados: {
          customers: [
            { id: 'c1', name: 'Joana Silva', tradeName: null, document: null, phone: '41999' },
          ],
        },
      },
      '/sales': {
        ok: true,
        dados: {
          sales: [
            {
              id: 'v1',
              number: 42,
              soldAt: '2026-10-07T12:00:00Z',
              customerName: null,
              grossAmountCents: 5000,
              discountCents: 500,
            },
          ],
        },
      },
    }

    const r = await buscarTudo('ar')

    expect(r.map((x) => [x.tipo, x.rota])).toEqual([
      ['produto', { pathname: '/produto', params: { id: 'p1' } }],
      ['cliente', { pathname: '/cliente', params: { id: 'c1' } }],
      ['venda', { pathname: '/vendas', params: { q: '42' } }],
    ])
    /* Sem documento, o apoio do cliente cai para o telefone. */
    expect(r[1]!.apoio).toBe('41999')
    expect(r[2]!.apoio).toContain('07/10/2026')
  })

  it('uma busca que falha nao derruba as outras', async () => {
    respostas = {
      '/clientes': {
        ok: true,
        dados: { customers: [{ id: 'c1', name: 'Ana', document: '1', phone: null }] },
      },
    }
    const r = await buscarTudo('an')
    expect(r.map((x) => x.tipo)).toEqual(['cliente'])
  })
})

describe('sino de avisos — NR-162', () => {
  it('monta os avisos com a rota e o filtro de cada um', async () => {
    respostas = {
      '/produtos/resumo': { ok: true, dados: { belowMinimum: 5, outOfStock: 2 } },
      '/contas-a-pagar': {
        ok: true,
        dados: { temVencidas: true, grupos: [{ faixa: 'overdue', payables: [{}, {}, {}] }] },
      },
      '/suporte/chamados': { ok: true, dados: { unread: 1 } },
      '/clientes?filter=inativos': { ok: true, dados: { total: 4 } },
      '/conexoes/pendentes': { ok: true, dados: { count: 0 } },
    }

    const avisos = await carregarAvisos(true)

    expect(avisos.map((a) => [a.texto, a.rota, a.contagem])).toEqual([
      ['2 produtos esgotados', { pathname: '/catalogo', params: { estoque: 'esgotado' } }, 2],
      /* Abaixo do minimo MENOS os esgotados: 5 - 2. */
      ['3 produtos para repor', { pathname: '/catalogo', params: { estoque: 'baixo' } }, 3],
      ['1 resposta do suporte', { pathname: '/suporte' }, 1],
      [
        '4 clientes sem comprar há muito tempo',
        { pathname: '/clientes', params: { filtro: 'inativos' } },
        4,
      ],
      ['3 contas vencidas', { pathname: '/contas-a-pagar' }, 3],
    ])
  })

  it('guarda por um minuto: a segunda leitura nao consulta de novo', async () => {
    respostas = { '/produtos/resumo': { ok: true, dados: { belowMinimum: 0, outOfStock: 0 } } }
    await carregarAvisos(true)
    const depois = chamadas.length
    await carregarAvisos()
    expect(chamadas.length).toBe(depois)
  })

  it('so conta como novo o que mudou desde a ultima olhada', async () => {
    respostas = { '/produtos/resumo': { ok: true, dados: { belowMinimum: 1, outOfStock: 1 } } }
    const avisos = await carregarAvisos(true)
    expect(avisosNovos(avisos, await lerAvisosVistos())).toHaveLength(1)

    await marcarAvisosVistos(avisos)
    expect(avisosNovos(avisos, await lerAvisosVistos())).toHaveLength(0)

    /* Um esgotado a mais e novidade de novo. */
    respostas = { '/produtos/resumo': { ok: true, dados: { belowMinimum: 2, outOfStock: 2 } } }
    const mudou = await carregarAvisos(true)
    expect(avisosNovos(mudou, await lerAvisosVistos())).toHaveLength(1)
  })
})

describe('vendas na semana — NR-161', () => {
  const resumo = (gross: number) => ({
    ok: true,
    dados: {
      summary: { salesCount: 1, grossCents: gross, netCents: gross, averageTicketCents: gross },
    },
  })

  it('pergunta dia a dia e o ultimo dia e hoje', async () => {
    respostas = { '/sales': resumo(1000) }
    const s = await carregarSemana(new Date(2026, 9, 7, 15))
    expect(chamadas.filter((c) => c.startsWith('/sales'))).toHaveLength(7)
    expect(chamadas.at(-1)).toContain('from=2026-10-07&to=2026-10-07')
    expect(s?.dias.map((d) => d.rotulo)).toEqual(['qui', 'sex', 'sab', 'dom', 'seg', 'ter', 'qua'])
    expect(s?.hoje.averageTicketCents).toBe(1000)
  })

  it('e tudo ou nada: um dia que falha nao vira dia sem venda', async () => {
    let n = 0
    const { chamarApi } = await import('./api')
    vi.mocked(chamarApi).mockImplementation(() => {
      n += 1
      return Promise.resolve(n === 3 ? { ok: false, message: 'caiu' } : resumo(500)) as never
    })
    expect(await carregarSemana(new Date(2026, 9, 7))).toBeNull()
  })
})
