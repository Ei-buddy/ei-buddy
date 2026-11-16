import { describe, expect, it, vi } from 'vitest'

const enviar = vi.fn()

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: enviar })) },
}))

const { criarEmailSmtp } = await import('./email-smtp.js')
const { criarEmailEmLog } = await import('./email-em-log.js')

const CONFIG = {
  host: 'smtp.local',
  port: 587,
  secure: false,
  from: 'EiBuddy <nao-responda@local>',
}

describe('e-mail por SMTP — NR-014', () => {
  it('envia com o remetente da configuracao', async () => {
    enviar.mockResolvedValueOnce(undefined)

    await criarEmailSmtp(CONFIG).send({ to: 'a@b.local', subject: 'Assunto', text: 'Corpo' })

    expect(enviar).toHaveBeenCalledWith(
      expect.objectContaining({ from: CONFIG.from, to: 'a@b.local' }),
    )
  })

  /*
   * Quem chama e `requestPasswordReset`, que responde a MESMA coisa com ou sem
   * conta (RF-120). Deixar a excecao subir faria o endpoint responder 500
   * quando o e-mail existe e 200 quando nao existe — e essa diferenca e
   * exatamente o que a regra existe para esconder.
   */
  it('falha de envio nao propaga', async () => {
    enviar.mockRejectedValueOnce(new Error('conexao recusada'))

    await expect(
      criarEmailSmtp(CONFIG).send({ to: 'a@b.local', subject: 'Assunto', text: 'Corpo' }),
    ).resolves.toBeUndefined()
  })

  /* Achado do QA: o teste NAO engole a falha — o motivo e o diagnostico. */
  it('o envio de teste devolve o motivo da recusa do servidor', async () => {
    enviar.mockRejectedValueOnce(new Error('535-5.7.8 Username and Password not accepted'))
    const email = criarEmailSmtp(CONFIG)
    expect(email.mode).toBe('smtp')
    expect(await email.test('eu@loja.local')).toEqual({
      ok: false,
      reason: '535-5.7.8 Username and Password not accepted',
    })
  })

  it('o envio de teste que sai responde ok', async () => {
    enviar.mockResolvedValueOnce(undefined)
    expect(await criarEmailSmtp(CONFIG).test('eu@loja.local')).toEqual({ ok: true })
    expect(enviar).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: 'eu@loja.local', subject: 'Teste de e-mail do EiBuddy' }),
    )
  })
})

describe('e-mail so no log — achado do QA', () => {
  it('o teste diz que nada sai e o que falta configurar', async () => {
    const email = criarEmailEmLog(true)
    expect(email.mode).toBe('log')
    const r = await email.test('eu@loja.local')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/SMTP_PASSWORD/)
  })
})
