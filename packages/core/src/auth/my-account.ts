import type {
  ChangeEmailInput,
  ChangeNameInput,
  ChangePasswordInput,
  MyAccountOutput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { IdentityProvider, UserDirectory } from '../ports/identity.js'
import type { IdentityAccountEditor, UserContacts } from '../ports/phone-change.js'
import type { QuemTroca } from './change-phone.js'

/**
 * Meu perfil — NR-153. Nome, e-mail e senha da PESSOA logada.
 *
 * Mesmo desenho da troca de celular (RF-132): o que muda como se entra na conta
 * (e-mail e senha) pede a senha atual; o nome, nao. A escrita no provedor vem
 * primeiro e a nossa depois — se a nossa falhar, o provedor volta ao que era,
 * para os dois nao discordarem sobre qual e o e-mail de entrar.
 */
export type MyAccountDeps = {
  readonly contacts: UserContacts
  readonly provider: IdentityProvider
  readonly editor: IdentityAccountEditor
  readonly users: Pick<UserDirectory, 'findByEmail'>
  readonly audit: AuditTrail
}

export async function myAccount(
  deps: Pick<MyAccountDeps, 'contacts'>,
  quem: Pick<QuemTroca, 'userId'>,
): Promise<MyAccountOutput> {
  const contato = await deps.contacts.contactOf(quem.userId)
  if (contato === undefined) throw AppError.unauthorized('Sua sessao nao vale mais. Entre de novo.')
  return { name: contato.name, email: contato.email, phone: contato.phone }
}

export async function changeName(
  deps: Pick<MyAccountDeps, 'contacts' | 'audit'>,
  quem: QuemTroca,
  input: ChangeNameInput,
): Promise<MyAccountOutput> {
  const contato = await deps.contacts.contactOf(quem.userId)
  if (contato === undefined) throw AppError.unauthorized('Sua sessao nao vale mais. Entre de novo.')

  if (contato.name !== input.name) {
    await deps.contacts.changeName(quem.userId, input.name)
    await registrar(deps.audit, quem, { name: contato.name }, { name: input.name })
  }

  return { name: input.name, email: contato.email, phone: contato.phone }
}

export async function changeEmail(
  deps: MyAccountDeps,
  quem: QuemTroca,
  input: ChangeEmailInput,
): Promise<MyAccountOutput> {
  const { contato, subject } = await conferirSenha(deps, quem, input.secret)
  const novo = input.email.toLowerCase()

  if (contato.email?.toLowerCase() === novo) {
    return { name: contato.name, email: contato.email, phone: contato.phone }
  }

  const dono = await deps.users.findByEmail(novo)
  if (dono !== undefined && dono.id !== quem.userId) {
    /* A pessoa esta logada e escolheu o endereco: dizer que ele esta em uso
       nao revela nada que o cadastro ja nao revelasse. */
    throw AppError.conflict('Este e-mail ja esta em uso por outra conta.')
  }

  if (!(await deps.editor.setEmail(subject, novo))) {
    throw AppError.conflict('Nao foi possivel trocar o e-mail desta conta agora.')
  }

  try {
    await deps.contacts.changeEmail(quem.userId, novo)
  } catch (erro) {
    if (contato.email !== null) {
      await deps.editor.setEmail(subject, contato.email).catch(() => undefined)
    }
    throw erro
  }

  await registrar(deps.audit, quem, { email: contato.email }, { email: novo })

  return { name: contato.name, email: novo, phone: contato.phone }
}

export async function changePassword(
  deps: MyAccountDeps,
  quem: QuemTroca,
  input: ChangePasswordInput,
): Promise<void> {
  const { subject } = await conferirSenha(deps, quem, input.secret)

  if (!(await deps.editor.setSecretFor(subject, input.newSecret))) {
    throw AppError.conflict('Nao foi possivel trocar a senha desta conta agora.')
  }

  /* A senha nunca entra na trilha — so o fato de ter mudado. */
  await registrar(deps.audit, quem, { kind: 'password_change' }, { kind: 'password_change' })
}

async function conferirSenha(deps: MyAccountDeps, quem: QuemTroca, secret: string) {
  const contato = await deps.contacts.contactOf(quem.userId)
  if (contato === undefined) throw AppError.unauthorized('Sua sessao nao vale mais. Entre de novo.')

  const identificador = contato.email ?? contato.phone
  const conferida =
    identificador === null
      ? undefined
      : await deps.provider.verify({ identifier: identificador, secret })

  /* Ver `changePhone`: o `auth_subject` so e gravado no primeiro login. */
  if (
    conferida === undefined ||
    (contato.subject !== null && conferida.subject !== contato.subject)
  ) {
    throw AppError.validation('Senha incorreta.', [{ path: 'secret', message: 'Senha incorreta.' }])
  }

  return { contato, subject: contato.subject ?? conferida.subject }
}

async function registrar(
  audit: AuditTrail,
  quem: QuemTroca,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  /* Sem loja ativa nao ha trilha onde gravar — a trilha e por empresa. */
  if (quem.companyId === null) return
  await audit.record({
    companyId: quem.companyId,
    entity: 'User',
    entityId: quem.userId,
    action: 'updated',
    actorId: quem.userId,
    channel: 'app',
    occurredAt: quem.now,
    before,
    after,
  })
}
