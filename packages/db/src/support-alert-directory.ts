import type { SupportAlertDirectory } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * O que o aviso de chamado novo precisa do banco — DEC-029, NR-220.
 *
 * - `destinatarios`: os Super Admins ativos, pela funcao da migration 0050
 *   (a tabela `platform_admins` nao tem politica de RLS: so funcao le).
 * - `nomeDaLoja`: o nome que a equipe reconhece, lido DENTRO do tenant de
 *   quem abriu o chamado — nada atravessa empresa aqui.
 */
export function createSupportAlertDirectory(sql: Sql): SupportAlertDirectory {
  return {
    destinatarios: async () => {
      const linhas = await sql<{ name: string; email: string }[]>`
        SELECT name, email FROM platform_alert_recipients()
      `
      return linhas.map((l) => ({ nome: l.name, email: l.email }))
    },

    nomeDaLoja: async (companyId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<{ nome: string }[]>`
          SELECT COALESCE(trade_name, legal_name) AS nome
            FROM companies
           WHERE id = ${companyId}
        `,
      )
      return linha?.nome ?? null
    },
  }
}
