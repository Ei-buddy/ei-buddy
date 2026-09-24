import type { UserId } from '../context.js'

/**
 * Recuperar senha — NR-014, RF-119.
 *
 * Tres portas pequenas, e nao uma grande, porque cada uma e trocada por um
 * motivo diferente: o link mora no nosso banco, a senha mora no provedor de
 * identidade (ADR-0002), e o e-mail sai por um provedor que ainda nao foi
 * escolhido.
 */

/** O link de redefinicao — uso unico, com prazo. */
export type PasswordResetTokens = {
  /** Devolve o token EM TEXTO, que so existe no e-mail. O banco guarda o hash. */
  issue(userId: UserId, email: string, expiresAt: Date): Promise<string>
  /**
   * Consome o link e encerra as sessoes da pessoa. `undefined` para o que nao
   * existe, ja foi usado ou venceu — os tres sao "link invalido" para quem
   * clicou, e distinguir contaria que aquele link existiu.
   */
  consume(token: string): Promise<{ readonly userId: UserId; readonly email: string } | undefined>
}

/** Quem troca a senha: o provedor de identidade. */
export type PasswordSetter = {
  /** `false` quando o provedor nao tem credencial para este e-mail. */
  setSecret(email: string, secret: string): Promise<boolean>
}

/** Envio de e-mail. O provedor real espera a decisao; ate la, um falso. */
export type EmailSender = {
  send(mensagem: {
    readonly to: string
    readonly subject: string
    readonly text: string
  }): Promise<void>
}
