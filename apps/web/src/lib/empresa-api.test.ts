import { afterEach, describe, expect, it, vi } from 'vitest'
import { certificadoDaSituacao, enviarCertificado } from './empresa-api'

/** Envio do certificado A1 — NR-214: a validade passou a ser opcional. */

const situacao = (venceEm: string | null) => ({
  hasToken: false,
  hasCertificate: true,
  certificateExpiresAt: venceEm,
  hasCscProduction: false,
  hasCscHomologation: false,
  focus: { available: false, syncedAt: null, error: null },
})

const arquivo = (nome = 'a1.pfx') => new File([new Uint8Array([1, 2, 3, 4])], nome)

describe('enviarCertificado', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sem a validade digitada, nao manda o campo — o servidor le do arquivo', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(situacao('2099-12-31')),
    )
    vi.stubGlobal('fetch', fetch)

    const r = await enviarCertificado(arquivo(), 'segredo', '')

    const corpo = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
    expect(corpo).toEqual({ certificateBase64: 'AQIDBA==', certificatePassword: 'segredo' })
    /* A tela mostra a data que o servidor confirmou. */
    expect(r).toMatchObject({
      ok: true,
      certificado: { validoAte: '2099-12-31', status: 'valido' },
    })
  })

  it('com a validade digitada, ela vai junto', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(situacao('2028-06-30')),
    )
    vi.stubGlobal('fetch', fetch)

    await enviarCertificado(arquivo('a1.P12'), 'segredo', '2028-06-30')

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).certificateExpiresAt).toBe(
      '2028-06-30',
    )
  })

  it('a recusa do servidor (senha errada) chega como mensagem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { message: 'A senha não abre este certificado. Confira e envie de novo.' } },
          { status: 400 },
        ),
      ),
    )
    expect(await enviarCertificado(arquivo(), 'errada', '')).toEqual({
      ok: false,
      error: 'A senha não abre este certificado. Confira e envie de novo.',
    })
  })

  it('sem senha ou com outra extensao nem chega a enviar', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect((await enviarCertificado(arquivo(), '', '')).ok).toBe(false)
    expect((await enviarCertificado(arquivo('a1.pdf'), 'segredo', '')).ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('certificadoDaSituacao — a tela ao abrir', () => {
  it('sem certificado guardado, nada', () => {
    expect(
      certificadoDaSituacao({ hasCertificate: false, certificateExpiresAt: null }, '2026-11-12'),
    ).toBeNull()
  })

  it('guardado e valido; vence hoje ainda vale', () => {
    expect(
      certificadoDaSituacao(
        { hasCertificate: true, certificateExpiresAt: '2026-11-12' },
        '2026-11-12',
      ),
    ).toEqual({ status: 'valido', nomeArquivo: 'Certificado A1', validoAte: '2026-11-12' })
  })

  it('guardado e vencido', () => {
    expect(
      certificadoDaSituacao(
        { hasCertificate: true, certificateExpiresAt: '2026-11-11' },
        '2026-11-12',
      )?.status,
    ).toBe('expirado')
  })
})
