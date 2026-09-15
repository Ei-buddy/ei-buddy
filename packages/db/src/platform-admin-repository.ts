import type { PlatformAdminAccess } from '@na-regua/core'
import type { CompanyOverview, PlatformAdminOutput } from '@na-regua/contracts'
import type { Sql } from 'postgres'
import { hashDoToken } from './session-repository.js'

/**
 * Implementacao do `PlatformAdminAccess` — ADR-0007, RF-131.
 *
 * Cada metodo e uma chamada a uma funcao `SECURITY DEFINER` da migration
 * 0008. Nenhuma logica de autorizacao mora aqui: quem confere `is_platform_admin`
 * e a propria funcao (e, antes dela, `core` — ver `platform-admin.ts`). Este
 * arquivo so traduz forma de dado, do jeito que `session-repository.ts` faz
 * para `sessions`.
 */

type LinhaDeEmpresa = {
  id: string
  legal_name: string
  trade_name: string | null
  cnpj: string
  is_active: boolean
  created_at: string
}

const paraEmpresa = (l: LinhaDeEmpresa): CompanyOverview => ({
  id: l.id,
  legalName: l.legal_name,
  tradeName: l.trade_name,
  cnpj: l.cnpj,
  isActive: l.is_active,
  createdAt: l.created_at,
})

type LinhaDeAdmin = { user_id: string; name: string; email: string; granted_at: string }

const paraAdmin = (l: LinhaDeAdmin): PlatformAdminOutput => ({
  userId: l.user_id,
  name: l.name,
  email: l.email,
  grantedAt: l.granted_at,
})

export function createPlatformAdminAccess(sql: Sql): PlatformAdminAccess {
  return {
    isPlatformAdmin: async (userId) => {
      const [linha] = await sql<{ platform_admin_is: boolean }[]>`
        SELECT platform_admin_is(${userId})
      `
      return linha?.platform_admin_is ?? false
    },

    enterCompany: async (token, companyId, justification) => {
      await sql`
        SELECT auth_session_enter_company(${hashDoToken(token)}, ${companyId}, ${justification})
      `
    },

    exitCompany: async (token) => {
      await sql`SELECT auth_session_exit_company(${hashDoToken(token)})`
    },

    listCompanies: async (requestedBy) => {
      const linhas = await sql<LinhaDeEmpresa[]>`
        SELECT * FROM platform_admin_list_companies(${requestedBy})
      `
      return linhas.map(paraEmpresa)
    },

    grant: async (userId, grantedBy) => {
      await sql`SELECT platform_admin_grant(${userId}, ${grantedBy})`
    },

    revoke: async (userId, revokedBy) => {
      await sql`SELECT platform_admin_revoke(${userId}, ${revokedBy})`
    },

    listAdmins: async (requestedBy) => {
      const linhas = await sql<LinhaDeAdmin[]>`
        SELECT * FROM platform_admin_list(${requestedBy})
      `
      return linhas.map(paraAdmin)
    },
  }
}
