import type { UserId } from '../context.js'

/**
 * Trocar o celular — RF-132, ADR-0012.
 *
 * Duas portas porque o celular mora em dois lugares: em `users` (e o que o canal
 * WhatsApp le para saber quem opera a loja) e no provedor de identidade (e com
 * ele que se entra por telefone).
 */
export type UserContacts = {
  contactOf(userId: UserId): Promise<
    | {
        readonly email: string | null
        readonly phone: string | null
        readonly subject: string | null
        readonly name: string
      }
    | undefined
  >
  changePhone(userId: UserId, phone: string): Promise<void>
  /** Meu perfil — NR-153. */
  changeEmail(userId: UserId, email: string): Promise<void>
  changeName(userId: UserId, name: string): Promise<void>
}

/** O lado do provedor: o login por telefone passa a aceitar o numero novo. */
export type IdentityPhoneChanger = {
  /** `false` quando o provedor nao conhece este `subject`. */
  setPhone(subject: string, novo: string): Promise<boolean>
}

/**
 * Trocar e-mail e senha no provedor de identidade — NR-153. Pelo `subject`, e
 * nao pelo e-mail: quem entra pelo celular tem e-mail sintetico no provedor.
 */
export type IdentityAccountEditor = {
  setEmail(subject: string, novo: string): Promise<boolean>
  setSecretFor(subject: string, secret: string): Promise<boolean>
}
