import { AppError } from '../app-error.js'
import type { UserDirectory } from '../ports/identity.js'
import type { EmailSender, PasswordResetTokens, PasswordSetter } from '../ports/password-reset.js'

/** Quanto tempo o link vale. Curto: e uma senha trocavel viajando por e-mail. */
const VALIDADE_DO_LINK_MINUTOS = 60

export type RequestPasswordResetDeps = {
  readonly users: Pick<UserDirectory, 'findByEmail'>
  readonly resetTokens: PasswordResetTokens
  readonly email: EmailSender
  /** Onde fica a tela de redefinir. Vem da configuracao, NUNCA da requisicao. */
  readonly webUrl: string
}

/**
 * Pedir o link — NR-014, RF-119, RF-120.
 *
 * Responde IGUAL exista ou nao a conta: dizer "esse e-mail nao tem cadastro"
 * transformaria o formulario em consultor de contas, que e o que a RF-120
 * proibe no login. Quem chama devolve sempre a mesma frase.
 *
 * O endereco do link vem de `webUrl`, e nao do cabecalho da requisicao: com o
 * `Host` de quem pediu, um atacante mandaria a VITIMA um e-mail legitimo com
 * link para o dominio dele — e o token iria junto no clique.
 */
export async function requestPasswordReset(
  deps: RequestPasswordResetDeps,
  entrada: { readonly email: string },
  agora: Date,
): Promise<void> {
  const email = entrada.email.trim().toLowerCase()
  const usuario = await deps.users.findByEmail(email)
  if (usuario === undefined || !usuario.isActive) return

  const expiraEm = new Date(agora.getTime() + VALIDADE_DO_LINK_MINUTOS * 60_000)
  const token = await deps.resetTokens.issue(usuario.id, email, expiraEm)

  const link = `${deps.webUrl.replace(/\/$/, '')}/redefinir-senha?token=${encodeURIComponent(token)}`

  await deps.email.send({
    to: email,
    subject: 'Redefinir sua senha do Ei Buddy',
    text: [
      `Olá, ${usuario.name}.`,
      '',
      'Recebemos um pedido para redefinir a sua senha. Para criar uma nova, abra o link abaixo:',
      '',
      link,
      '',
      `O link vale por ${VALIDADE_DO_LINK_MINUTOS} minutos e só pode ser usado uma vez.`,
      'Se não foi você, ignore este e-mail: a sua senha continua a mesma.',
    ].join('\n'),
  })
}

export type ResetPasswordDeps = {
  readonly resetTokens: PasswordResetTokens
  readonly passwords: PasswordSetter
}

/**
 * Trocar a senha pelo link — NR-014.
 *
 * O link e consumido ANTES de trocar a senha: e o consumo que garante o uso
 * unico, e ele ja encerra as sessoes abertas (quem troca a senha porque alguem
 * entrou precisa que esse alguem saia).
 */
export async function resetPassword(
  deps: ResetPasswordDeps,
  entrada: { readonly token: string; readonly secret: string },
): Promise<void> {
  const link = await deps.resetTokens.consume(entrada.token)
  if (link === undefined) {
    throw AppError.validation('Este link é inválido ou já venceu. Peça um novo.', [
      { path: 'token', message: 'Este link é inválido ou já venceu. Peça um novo.' },
    ])
  }

  if (!(await deps.passwords.setSecret(link.email, entrada.secret))) {
    throw AppError.validation('Não foi possível trocar a senha. Peça um novo link.')
  }
}
