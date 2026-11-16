import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Orcamentos no celular: painel, busca e situacao — NR-210, o par do web. */

vi.mock('react-native', () => ({ Linking: {}, Share: {} }))
vi.mock('./empresa-api', () => ({ carregarEmpresa: vi.fn() }))
vi.mock('./api', () => ({ chamarApi: vi.fn() }))

const { chamarApi } = await import('./api')
const { carregarOrcamentos, consultaDosOrcamentos, conversao, situacaoDe } =
  await import('./orcamentos-api')
const { inicioDosUltimosDias } = await import('./periodo')

const resumo = {
  open: { count: 2, totalCents: 3000 },
  expired: { count: 1, totalCents: 500 },
  converted: { count: 1, totalCents: 900 },
  cancelled: { count: 0, totalCents: 0 },
}

describe('consulta', () => {
  it('so o que veio', () => {
    expect(consultaDosOrcamentos({ termo: ' ', situacao: '', pagina: 1 })).toBe(
      'page=1&pageSize=20',
    )
  })

  it('termo, situacao e periodo', () => {
    const q = new URLSearchParams(
      consultaDosOrcamentos({
        termo: ' ana ',
        situacao: 'converted',
        de: '2026-10-01',
        ate: '2026-10-09',
        pagina: 2,
      }),
    )
    expect(Object.fromEntries(q)).toEqual({
      page: '2',
      pageSize: '20',
      q: 'ana',
      situation: 'converted',
      from: '2026-10-01',
      to: '2026-10-09',
    })
  })
})

describe('carregarOrcamentos', () => {
  beforeEach(() => vi.mocked(chamarApi).mockReset())

  it('traduz a pagina e o painel', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { quotes: [], total: 4, page: 1, pageSize: 20, summary: resumo },
    } as never)
    const r = await carregarOrcamentos({ termo: '', situacao: 'expired', pagina: 1 })
    expect(vi.mocked(chamarApi).mock.calls[0]?.[0]).toBe(
      '/orcamentos?page=1&pageSize=20&situation=expired',
    )
    expect(r).toEqual({ ok: true, dados: { orcamentos: [], total: 4, resumo } })
  })

  it('erro vira a mensagem', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: false, message: 'Sem conexão.' } as never)
    expect(await carregarOrcamentos({ termo: '', situacao: '', pagina: 1 })).toEqual({
      ok: false,
      erro: 'Sem conexão.',
    })
  })
})

describe('situacao e conversao', () => {
  const o = { status: 'open', validUntil: '2026-10-10' } as never

  it('vencido so depois do dia da validade', () => {
    expect(situacaoDe(o, '2026-10-10')).toBe('open')
    expect(situacaoDe(o, '2026-10-11')).toBe('expired')
  })

  it('conversao sobre os desfechos', () => {
    expect(conversao(resumo)).toBe(50)
    expect(
      conversao({
        ...resumo,
        expired: { count: 0, totalCents: 0 },
        converted: { count: 0, totalCents: 0 },
      }),
    ).toBeNull()
  })
})

describe('inicioDosUltimosDias', () => {
  it('conta hoje; atravessa o mes pelos campos locais', () => {
    const agora = new Date(2026, 9, 9, 23, 50)
    expect(inicioDosUltimosDias(1, agora)).toBe('2026-10-09')
    expect(inicioDosUltimosDias(7, agora)).toBe('2026-10-03')
    expect(inicioDosUltimosDias(30, new Date(2026, 2, 5))).toBe('2026-02-04')
  })
})
