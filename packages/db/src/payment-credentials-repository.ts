import type { Sql } from 'postgres'
import { cifrar, decifrar } from './secret-box.js'
import { withTenant } from './tenant.js'

/**
 * Cofre da conta de recebimento do lojista — NR-044, RNF-022.
 *
 * Mesmo desenho de `createFiscalCredentials`: a cifragem acontece AQUI, e nao
 * em quem chama. Um unico lugar decide o algoritmo, e nao ha caminho em que
 * alguem grave a chave da subconta em texto puro por esquecimento.
 *
 * O retorno satisfaz `CredenciaisAsaas` (de `packages/payments`)
 * estruturalmente — `db` nao importa `payments`, e nao precisa: a forma e uma
 * funcao de `companyId` para chave.
 */
export function createPaymentCredentials(
  sql: Sql,
  chave: Buffer,
): {
  apiKeyDaEmpresa(companyId: string): Promise<string | undefined>
  salvar(entrada: {
    readonly companyId: string
    readonly apiKey: string
    readonly atualizadoPor: string
  }): Promise<void>
  /** Se a loja ja tem conta configurada — sem trazer o segredo junto. */
  temConta(companyId: string): Promise<boolean>
} {
  return {
    /**
     * `undefined` quando a loja nao configurou — e nao um erro.
     *
     * Falta de conta de recebimento e estado normal: a loja vende no balcao
     * antes de cobrar a distancia. Quem transforma isso em recusa e o adapter,
     * com uma mensagem que diz o que configurar.
     */
    apiKeyDaEmpresa: async (companyId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<{ api_key: string | null }[]>`
          SELECT api_key FROM company_payment_credentials WHERE company_id = ${companyId}
        `,
      )
      if (linha?.api_key == null) return undefined

      return decifrar(linha.api_key, chave, companyId)
    },

    salvar: async (entrada) => {
      await withTenant(
        sql,
        entrada.companyId,
        (tx) => tx`
          INSERT INTO company_payment_credentials (company_id, api_key, updated_by, updated_at)
          VALUES (
            ${entrada.companyId},
            ${cifrar(entrada.apiKey, chave, entrada.companyId)},
            ${entrada.atualizadoPor},
            now()
          )
          ON CONFLICT (company_id) DO UPDATE
             SET api_key = EXCLUDED.api_key,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = now()
        `,
      )
    },

    /* Responde pela PRESENCA, sem decifrar: a tela de Empresa pergunta "ja
       configurou?" e nao precisa da chave em memoria para isso. */
    temConta: async (companyId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<{ existe: boolean }[]>`
          SELECT api_key IS NOT NULL AS existe
            FROM company_payment_credentials
           WHERE company_id = ${companyId}
        `,
      )
      return linha?.existe === true
    },
  }
}
