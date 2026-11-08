import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  carregarOrcamentos,
  consultaDosOrcamentos,
  conversao,
  situacaoDe,
  type FiltroDosOrcamentos,
  type Orcamento,
} from './orcamentos-api'
import { PERIODOS, periodoDe } from './periodos'

/** Orcamentos: painel, busca e situacao — NR-210. */

const filtro = (over: Partial<FiltroDosOrcamentos> = {}): FiltroDosOrcamentos => ({
  termo: '',
  situacao: '',
  de: '',
  ate: '',
  pagina: 1,
  porPagina: 20,
  ...over,
})

const orcamento = (over: Partial<Orcamento> = {}): Orcamento => ({
  id: 'o1',
  number: 1,
  customerId: 'c1',
  customerName: 'Joana',
  status: 'open',
  validUntil: '2026-10-10',
  notes: null,
  discountCents: 0,
  totalCents: 1000,
  saleId: null,
  saleNumber: null,
  items: [],
  createdAt: '2026-10-01T12:00:00.000Z',
  ...over,
})

describe('consulta da lista', () => {
  it('so manda o que veio preenchido', () => {
    expect(consultaDosOrcamentos(filtro())).toBe('page=1&pageSize=20')
  })

  it('busca aparada, situacao, periodo e pagina', () => {
    const q = new URLSearchParams(
      consultaDosOrcamentos(
        filtro({
          termo: '  joana  ',
          situacao: 'expired',
          de: '2026-10-01',
          ate: '2026-10-07',
          pagina: 3,
        }),
      ),
    )
    expect(Object.fromEntries(q)).toEqual({
      page: '3',
      pageSize: '20',
      q: 'joana',
      situation: 'expired',
      from: '2026-10-01',
      to: '2026-10-07',
    })
  })

  it('termo so de espacos nao vira busca', () => {
    expect(consultaDosOrcamentos(filtro({ termo: '   ' }))).not.toContain('q=')
  })
})

describe('situacao de cada linha', () => {
  it('aberto com validade passada e vencido; no dia da validade ainda vale', () => {
    expect(situacaoDe(orcamento(), '2026-10-11')).toBe('expired')
    expect(situacaoDe(orcamento(), '2026-10-10')).toBe('open')
  })

  it('convertido e cancelado nao vencem', () => {
    expect(situacaoDe(orcamento({ status: 'converted' }), '2027-01-01')).toBe('converted')
    expect(situacaoDe(orcamento({ status: 'cancelled' }), '2027-01-01')).toBe('cancelled')
  })
})

describe('conversao', () => {
  const t = (count: number) => ({ count, totalCents: count * 100 })

  it('vendidos sobre os que tiveram desfecho; o aberto no prazo fica fora', () => {
    expect(conversao({ open: t(9), expired: t(1), converted: t(2), cancelled: t(1) })).toBe(50)
  })

  it('sem nenhum desfecho nao ha taxa', () => {
    expect(conversao({ open: t(3), expired: t(0), converted: t(0), cancelled: t(0) })).toBeNull()
  })

  it('arredonda', () => {
    expect(conversao({ open: t(0), expired: t(2), converted: t(1), cancelled: t(0) })).toBe(33)
  })
})

describe('periodos', () => {
  it('pelos campos locais: hoje e ontem, 7 dias, qualquer', () => {
    const agora = new Date(2026, 9, 9, 23, 30)
    expect(periodoDe(0, agora)).toEqual({ de: '', ate: '' })
    expect(periodoDe(1, agora)).toEqual({ de: '2026-10-09', ate: '2026-10-09' })
    expect(periodoDe(7, agora)).toEqual({ de: '2026-10-03', ate: '2026-10-09' })
    expect(periodoDe(30, new Date(2026, 2, 5))).toEqual({ de: '2026-02-04', ate: '2026-03-05' })
    expect(PERIODOS.map((p) => p.valor)).toEqual([0, 1, 7, 30])
  })
})

describe('carregarOrcamentos', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('pede ao BFF com o filtro e traduz a resposta', async () => {
    const resumo = {
      open: { count: 1, totalCents: 1000 },
      expired: { count: 0, totalCents: 0 },
      converted: { count: 0, totalCents: 0 },
      cancelled: { count: 0, totalCents: 0 },
    }
    const fetch = vi.fn(async (_url: string) =>
      Response.json({ quotes: [orcamento()], total: 1, page: 1, pageSize: 20, summary: resumo }),
    )
    vi.stubGlobal('fetch', fetch)
    const r = await carregarOrcamentos(filtro({ termo: 'jo' }))
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/orcamentos?page=1&pageSize=20&q=jo')
    expect(r).toEqual({
      ok: true,
      dados: { orcamentos: [orcamento()], total: 1, pagina: 1, porPagina: 20, resumo },
    })
  })

  it('falha do servidor vira a mensagem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { message: 'O inicio do periodo nao pode ser depois do fim.' } },
          { status: 400 },
        ),
      ),
    )
    expect(await carregarOrcamentos(filtro())).toEqual({
      ok: false,
      erro: 'O inicio do periodo nao pode ser depois do fim.',
    })
  })
})
