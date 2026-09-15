import type { TipoDeDocumentoLegal } from '@na-regua/contracts'
import type { UserId } from '../context.js'

/**
 * Porta do consentimento legal — RF-02, RF-03, LGPD art. 8 §1.
 *
 * `user_consents` e cross-tenant no banco (aceite pertence a PESSOA, nao a
 * loja — a mesma pessoa dona de duas lojas aceitou uma vez so), entao cada
 * metodo mapeia para uma funcao `SECURITY DEFINER` da migration 0015. Mesmo
 * desenho de `PartnerApplicationRepository`.
 *
 * Nao existe `revoke` nem `update` de proposito: a tabela e append-only, e o
 * historico e a prova. "Mudei de ideia" se registra como um aceite novo de
 * outra versao, nunca apagando o anterior.
 */
export type LegalConsentRepository = {
  /**
   * Grava um aceite. A VERSAO vem de quem chama — e sempre a vigente do
   * servidor (`VERSOES_LEGAIS`), nunca um valor que o cliente escolheu.
   */
  record(input: {
    userId: UserId
    type: TipoDeDocumentoLegal
    version: string
    /** Prova de consentimento. Ausentes em caminho sem HTTP. */
    ip?: string
    userAgent?: string
  }): Promise<void>

  /** O aceite mais recente de cada documento — a base do calculo de pendencia. */
  latestFor(userId: UserId): Promise<
    readonly {
      type: TipoDeDocumentoLegal
      version: string
      acceptedAt: Date
    }[]
  >
}
