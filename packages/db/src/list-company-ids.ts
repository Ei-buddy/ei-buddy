import type { Sql } from 'postgres'
import { withPlatformScope } from './tenant.js'

/**
 * Ids de todas as empresas, sem tenant no contexto — NR-062 T056.
 *
 * `SELECT` cru em `companies` LANCA no papel da aplicacao: a politica raiz
 * usa `current_company_id()`, e consulta sem `app.company_id` e falha
 * fechada (RF-121). O job de expurgo precisa da lista inteira, e nao pode
 * ganhar `BYPASSRLS` so por isso.
 *
 * A saida e a funcao `list_company_ids` (migration 0020): `SECURITY DEFINER`
 * estreita, `search_path` fixo, so a coluna `id`. Nunca `legal_name`,
 * `cnpj` nem `email`. Molde de `auth_cnpj_taken`.
 *
 * Instanciada so na composicao do worker (`listTenantIds`).
 */
export async function listCompanyIds(sql: Sql): Promise<readonly string[]> {
  const linhas = await withPlatformScope(
    sql,
    (tx) => tx<{ id: string }[]>`SELECT id FROM list_company_ids()`,
  )
  return linhas.map((l) => l.id)
}
