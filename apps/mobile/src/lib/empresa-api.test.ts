import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Envio do certificado pelo celular — NR-214: a validade passou a ser opcional. */

vi.mock('./api', () => ({ chamarApi: vi.fn() }))

const { chamarApi } = await import('./api')
const { enviarCertificado } = await import('./empresa-api')

const situacao = {
  hasToken: false,
  hasCertificate: true,
  certificateExpiresAt: '2099-12-31',
  hasCscProduction: false,
  hasCscHomologation: false,
  focus: { available: false, syncedAt: null, error: null },
}

describe('enviarCertificado', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset()
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: situacao } as never)
  })

  it('sem data, nao manda a validade: o servidor le do arquivo', async () => {
    await enviarCertificado('AQID', 'segredo')
    expect(vi.mocked(chamarApi).mock.calls[0]?.[1]).toEqual({
      method: 'PUT',
      body: { certificateBase64: 'AQID', certificatePassword: 'segredo' },
    })
  })

  it('com data, ela vai junto', async () => {
    await enviarCertificado('AQID', 'segredo', '2028-06-30')
    expect(vi.mocked(chamarApi).mock.calls[0]?.[1]).toMatchObject({
      body: { certificateExpiresAt: '2028-06-30' },
    })
  })

  it('a recusa do servidor chega como mensagem', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      message: 'A senha não abre este certificado. Confira e envie de novo.',
    } as never)
    expect(await enviarCertificado('AQID', 'errada')).toEqual({
      ok: false,
      erro: 'A senha não abre este certificado. Confira e envie de novo.',
    })
  })
})
