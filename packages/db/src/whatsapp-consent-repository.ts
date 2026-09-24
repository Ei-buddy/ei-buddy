import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Consentimento de WhatsApp do cliente — RF-016.
 *
 * As duas colunas existem em `customers` desde a migration 0002, com o
 * comentario que explica a diferenca: "nulo = nunca houve manifestacao, que e
 * diferente de opt-out — uma exige pedir, a outra proibe pedir de novo".
 *
 * Nada as escrevia, e nada as lia: a composicao entregava ao caso de uso um
 * aceite fixo de 2026-01-01 para TODO cliente identificado. O bloqueio de
 * `sendCustomerCharge` funcionava contra um leitor que nunca dizia nao.
 *
 * Satisfaz `WhatsappConsentReader` de `core` estruturalmente — `db` nao importa
 * `core`.
 */

type LinhaConsentimento = {
  whatsapp_consent_at: Date | null
  whatsapp_opt_out_at: Date | null
}

export function createWhatsappConsentRepository(sql: Sql) {
  return {
    of: async (companyId: string, customerId: string) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaConsentimento[]>`
          SELECT whatsapp_consent_at, whatsapp_opt_out_at
            FROM customers
           WHERE id = ${customerId}
        `,
      )

      /*
       * Cliente inexistente ou de outra loja volta como "nunca se manifestou",
       * e nao como erro: quem chama ja conferiu que o cliente existe, e o
       * valor conservador aqui e o que BLOQUEIA o envio. Um erro faria a
       * cobranca falhar com mensagem tecnica onde a resposta certa e "peca o
       * aceite antes".
       */
      return {
        optedInAt: linha?.whatsapp_consent_at ?? null,
        optedOutAt: linha?.whatsapp_opt_out_at ?? null,
      }
    },

    /**
     * Registra o aceite ou a recusa — RF-016.
     *
     * Opt-in LIMPA o opt-out e vice-versa: as duas colunas descrevem a mesma
     * decisao em dois sentidos, e deixar as duas preenchidas criaria um estado
     * que ninguem sabe ler. O carimbo que fica e sempre o da ultima vontade
     * manifestada.
     *
     * `false` quando nao ha o que atualizar — inexistente ou de outra loja,
     * indistinguiveis daqui por causa da RLS.
     */
    record: async (
      companyId: string,
      customerId: string,
      decisao: 'opt_in' | 'opt_out',
      quando: Date,
      updatedBy: string,
    ): Promise<boolean> => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<{ id: string }[]>`
          UPDATE customers
             SET whatsapp_consent_at = ${decisao === 'opt_in' ? quando : null},
                 whatsapp_opt_out_at = ${decisao === 'opt_out' ? quando : null},
                 updated_by = ${updatedBy},
                 updated_at = now()
           WHERE id = ${customerId}
          RETURNING id
        `,
      )

      return linhas.length > 0
    },
  }
}
