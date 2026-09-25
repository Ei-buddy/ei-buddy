import type { ChangePhoneInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { UserId } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { IdentityProvider, UserDirectory } from '../ports/identity.js'
import type { IdentityPhoneChanger, UserContacts } from '../ports/phone-change.js'

export type ChangePhoneDeps = {
  readonly contacts: UserContacts
  readonly provider: IdentityProvider
  readonly phoneChanger: IdentityPhoneChanger
  readonly users: Pick<UserDirectory, 'findByPhone'>
  readonly audit: AuditTrail
}

/** Quem pede: a pessoa da sessao. A empresa so entra na trilha. */
export type QuemTroca = {
  readonly userId: UserId
  readonly companyId: string | null
  readonly now: Date
}

/** O celular atual, para a tela mostrar o que vai ser trocado. */
export async function currentPhone(
  deps: Pick<ChangePhoneDeps, 'contacts'>,
  userId: UserId,
): Promise<{ phone: string | null }> {
  const contato = await deps.contacts.contactOf(userId)
  return { phone: contato?.phone ?? null }
}

/**
 * Troca o celular da pessoa — RF-132, ADR-0012, NR-113.
 *
 * O celular do dono e o vinculo do canal WhatsApp: depois da troca, o numero
 * antigo deixa de operar a loja (o canal le `users.phone`) e o novo passa a.
 *
 * ## A ordem
 *
 * 1. **A senha.** Confere com o provedor, pelo e-mail (ou pelo celular atual).
 * 2. **O numero livre.** Dois donos com o mesmo celular fariam o canal escolher
 *    uma loja por sorte.
 * 3. **O provedor antes do banco.** Se o provedor recusar, nada mudou. Se o
 *    banco falhar depois, o provedor volta ao numero antigo — senao o login
 *    por telefone e o canal discordariam de quem e a pessoa.
 */
export async function changePhone(
  deps: ChangePhoneDeps,
  quem: QuemTroca,
  input: ChangePhoneInput,
): Promise<{ phone: string }> {
  const contato = await deps.contacts.contactOf(quem.userId)
  if (contato === undefined) {
    throw AppError.conflict('Nao foi possivel trocar o celular desta conta agora.')
  }

  const identificador = contato.email ?? contato.phone
  const conferida =
    identificador === null
      ? undefined
      : await deps.provider.verify({ identifier: identificador, secret: input.secret })

  /* `users.auth_subject` so e gravado no primeiro LOGIN; quem acabou de se
     cadastrar ainda nao o tem. Nesse caso vale o que a senha conferiu — e se
     ja houver um gravado, ele precisa bater. */
  if (
    conferida === undefined ||
    (contato.subject !== null && conferida.subject !== contato.subject)
  ) {
    throw AppError.validation('Senha incorreta.', [{ path: 'secret', message: 'Senha incorreta.' }])
  }
  const subject = contato.subject ?? conferida.subject

  if (contato.phone === input.phone) return { phone: input.phone }

  if ((await deps.users.findByPhone(input.phone)) !== undefined) {
    /* A pessoa esta logada e sabe o proprio numero: dizer que o NOVO esta em
       uso nao revela conta de ninguem que ela ja nao pudesse testar no cadastro. */
    throw AppError.conflict('Este celular ja esta em uso por outra conta.')
  }

  if (!(await deps.phoneChanger.setPhone(subject, input.phone))) {
    throw AppError.conflict('Nao foi possivel trocar o celular desta conta agora.')
  }

  try {
    await deps.contacts.changePhone(quem.userId, input.phone)
  } catch (erro) {
    if (contato.phone !== null) {
      await deps.phoneChanger.setPhone(subject, contato.phone).catch(() => undefined)
    }
    throw erro
  }

  if (quem.companyId !== null) {
    await deps.audit.record({
      companyId: quem.companyId,
      entity: 'User',
      entityId: quem.userId,
      action: 'updated',
      actorId: quem.userId,
      channel: 'app',
      occurredAt: quem.now,
      /* O numero sai mascarado: a trilha e lida por outros papeis da loja, e o
         celular inteiro da pessoa nao precisa estar la para provar a troca. */
      before: { phone: mascarar(contato.phone), kind: 'phone_change' },
      after: { phone: mascarar(input.phone) },
    })
  }

  return { phone: input.phone }
}

const mascarar = (phone: string | null): string | null =>
  phone === null ? null : `${phone.slice(0, 4)}*****${phone.slice(-2)}`
