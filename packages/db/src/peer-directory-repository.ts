import type { PeerDirectory } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withPlatformScope } from './tenant.js'

/**
 * Vinculo do canal WhatsApp — NR-113, RF-094, ADR-0012.
 *
 * `withPlatformScope`, e nao `withTenant`: a pergunta e justamente "de qual
 * empresa e este numero?", e ela nao cabe dentro de uma empresa. Quem
 * responde e `channel_owner_by_phone` (migration 0028), `SECURITY DEFINER`
 * com retorno minimo — o mesmo desenho de `auth_user_by_phone`.
 *
 * Nenhuma regra mora aqui. "So owner" e "a primeira empresa em ordem de
 * vinculo" estao na propria funcao SQL, num lugar so.
 */
export function createPeerDirectory(sql: Sql): PeerDirectory {
  return {
    porTelefone: async (phone) => {
      const [linha] = await withPlatformScope(
        sql,
        (tx) => tx<{ company_id: string; user_id: string }[]>`
          SELECT company_id, user_id FROM channel_owner_by_phone(${phone})
        `,
      )

      return linha === undefined
        ? undefined
        : { companyId: linha.company_id, userId: linha.user_id }
    },
  }
}
