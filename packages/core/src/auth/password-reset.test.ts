import { describe, expect, it } from 'vitest'
import type { PasswordResetTokens } from '../ports/password-reset.js'
import { requestPasswordReset, resetPassword } from './password-reset.js'

const AGORA = new Date('2026-09-24T12:00:00.000Z')

function cenario() {
  const enviados: { to: string; text: string }[] = []
  const emitidos: { userId: string; email: string; expiresAt: Date }[] = []
  const senhas = new Map<string, string>()
  const validos = new Map<string, { userId: string; email: string }>()

  const resetTokens: PasswordResetTokens = {
    issue: async (userId, email, expiresAt) => {
      emitidos.push({ userId, email, expiresAt })
      validos.set('tok-1', { userId, email })
      return 'tok-1'
    },
    consume: async (token) => {
      const link = validos.get(token)
      validos.delete(token)
      return link
    },
  }

  const deps = {
    users: {
      findByEmail: async (email: string) =>
        email === 'ana@loja.com' ? { id: 'usr-1', name: 'Ana', isActive: true } : undefined,
    },
    resetTokens,
    email: { send: async (m: { to: string; text: string }) => void enviados.push(m) },
    webUrl: 'https://eibuddy.com.br/',
    passwords: {
      setSecret: async (email: string, secret: string) => {
        senhas.set(email, secret)
        return true
      },
    },
  }
  return { deps, enviados, emitidos, senhas }
}

describe('recuperar senha — NR-014', () => {
  it('manda o link para a conta que existe, com o endereco da configuracao', async () => {
    const c = cenario()
    await requestPasswordReset(c.deps, { email: ' Ana@Loja.com ' }, AGORA)

    expect(c.emitidos[0]?.expiresAt.getTime()).toBe(AGORA.getTime() + 60 * 60_000)
    expect(c.enviados[0]?.to).toBe('ana@loja.com')
    expect(c.enviados[0]?.text).toContain('https://eibuddy.com.br/redefinir-senha?token=tok-1')
  })

  it('e-mail sem conta nao emite nem envia nada, e nao lanca (RF-120)', async () => {
    const c = cenario()
    await expect(
      requestPasswordReset(c.deps, { email: 'ninguem@loja.com' }, AGORA),
    ).resolves.toBeUndefined()

    expect(c.emitidos).toHaveLength(0)
    expect(c.enviados).toHaveLength(0)
  })

  it('o link troca a senha uma vez so', async () => {
    const c = cenario()
    await requestPasswordReset(c.deps, { email: 'ana@loja.com' }, AGORA)

    await resetPassword(c.deps, { token: 'tok-1', secret: 'nova-senha-1' })
    expect(c.senhas.get('ana@loja.com')).toBe('nova-senha-1')

    await expect(
      resetPassword(c.deps, { token: 'tok-1', secret: 'outra-senha-2' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
