import type { TestEmailInput, TestEmailOutput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { UserId } from '../context.js'
import type { PlatformAdminAccess } from '../ports/platform-admin.js'

/**
 * Como o servidor manda e-mail, e um envio de teste que DIZ o que deu errado
 * — achado do QA ("os e-mails nao estao funcionando").
 *
 * O envio do dia a dia engole a falha de proposito (a redefinicao de senha
 * responde igual com ou sem conta, RF-120), e por isso ninguem via que nada
 * saia: o servidor estava sem SMTP e so escrevia no log. O teste nao engole:
 * devolve o motivo (senha recusada pelo Gmail, porta bloqueada, sem SMTP).
 */
export type EmailTester = {
  /** `smtp` envia de verdade; `log` so escreve no log do servidor. */
  readonly mode: 'smtp' | 'log'
  test(to: string): Promise<{ ok: true } | { ok: false; reason: string }>
}

export type TestEmailDeps = {
  readonly platformAdmin: PlatformAdminAccess
  readonly emailTester: EmailTester
}

/** Envio de teste — so Super Admin: o resultado expoe como o servidor esta configurado. */
export async function sendTestEmail(
  deps: TestEmailDeps,
  requestedBy: UserId,
  input: TestEmailInput,
): Promise<TestEmailOutput> {
  if (!(await deps.platformAdmin.isPlatformAdmin(requestedBy))) {
    throw AppError.forbidden('Esta conta nao tem acesso de Super Admin.')
  }
  const r = await deps.emailTester.test(input.to)
  return r.ok
    ? { mode: deps.emailTester.mode, sent: true, reason: null }
    : { mode: deps.emailTester.mode, sent: false, reason: r.reason }
}
