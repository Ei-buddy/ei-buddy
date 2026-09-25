import { describe, expect, it, vi } from 'vitest'

const enviar = vi.fn()

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: enviar })) },
}))

const { criarEmailSmtp } = await import('./email-smtp.js')

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
})
