import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Excluir card do CRM — NR-213. */

vi.mock('./api', () => ({ chamarApi: vi.fn() }))

const { chamarApi } = await import('./api')
const { excluirCard } = await import('./crm-api')

describe('excluirCard', () => {
  beforeEach(() => vi.mocked(chamarApi).mockReset())

  it('manda DELETE no card certo', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: null } as never)
    expect(await excluirCard('abc/1')).toEqual({ ok: true, dados: null })
    expect(vi.mocked(chamarApi).mock.calls[0]).toEqual(['/crm/cards/abc%2F1', { method: 'DELETE' }])
  })

  it('erro vira a mensagem', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: false, message: 'Card não encontrado.' } as never)
    expect(await excluirCard('x')).toEqual({ ok: false, erro: 'Card não encontrado.' })
  })
})
