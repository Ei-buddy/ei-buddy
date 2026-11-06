import { describe, expect, it } from 'vitest'
import { InMemoryPlatformAdminAccess } from '../auth/fakes.js'
import { isAppError } from '../app-error.js'
import { sendTestEmail, type EmailTester } from './test-email.js'

/** Envio de teste de e-mail — achado do QA. */

function cenario(tester: EmailTester) {
  const platformAdmin = new InMemoryPlatformAdminAccess({ aoEntrar: () => {}, aoSair: () => {} })
  platformAdmin.tornarSuperAdmin('admin')
  return { platformAdmin, emailTester: tester }
}

describe('envio de teste de e-mail', () => {
  it('diz que saiu quando o SMTP aceitou', async () => {
    const deps = cenario({ mode: 'smtp', test: async () => ({ ok: true }) })
    expect(await sendTestEmail(deps, 'admin', { to: 'eu@loja.local' })).toEqual({
      mode: 'smtp',
      sent: true,
      reason: null,
    })
  })

  it('devolve o motivo quando nao saiu — e o modo log aparece', async () => {
    const deps = cenario({
      mode: 'log',
      test: async () => ({ ok: false, reason: 'sem SMTP' }),
    })
    expect(await sendTestEmail(deps, 'admin', { to: 'eu@loja.local' })).toEqual({
      mode: 'log',
      sent: false,
      reason: 'sem SMTP',
    })
  })

  it('so Super Admin', async () => {
    const deps = cenario({ mode: 'smtp', test: async () => ({ ok: true }) })
    const erro = await sendTestEmail(deps, 'outro', { to: 'eu@loja.local' }).catch((e) => e)
    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })
})
