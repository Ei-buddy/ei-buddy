import type { PasswordResetTokens } from '@na-regua/core'
import type { Sql } from 'postgres'
import { gerarToken, hashDoToken } from './session-repository.js'

/**
 * Links de redefinicao de senha — NR-014, migration 0033.
 *
 * Mesmo desenho da sessao: token sorteado que so existe na resposta (e no
 * e-mail), hash no banco, e acesso so pelas funcoes `auth_password_reset_*` —
 * a tabela tem RLS sem politica. Sem `withTenant`: quem pede o link nao entrou.
 */
export function createPasswordResetTokens(sql: Sql): PasswordResetTokens {
  return {
    issue: async (userId, email, expiresAt) => {
      const token = gerarToken()
      await sql`
        SELECT auth_password_reset_issue(${hashDoToken(token)}, ${userId}, ${email}, ${expiresAt})
      `
      return token
    },

    consume: async (token) => {
      const [linha] = await sql<{ user_id: string; email: string }[]>`
        SELECT * FROM auth_password_reset_consume(${hashDoToken(token)})
      `
      return linha === undefined ? undefined : { userId: linha.user_id, email: linha.email }
    },
  }
}
