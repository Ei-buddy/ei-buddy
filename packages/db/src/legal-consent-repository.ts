import type { LegalConsentRepository } from '@na-regua/core'
import type { TipoDeDocumentoLegal } from '@na-regua/contracts'
import type { Sql } from 'postgres'

/**
 * Implementacao de `LegalConsentRepository` — migration 0015.
 *
 * `user_consents` nao tem politica de RLS: cada metodo aqui e uma chamada a
 * uma funcao `SECURITY DEFINER`, mesmo molde de
 * `partner-application-repository.ts`.
 *
 * Nao ha traducao de erro para `AppError` de proposito. As excecoes que as
 * funcoes SQL levantam ("Documento legal desconhecido", "Usuario nao
 * encontrado") sao defesa em profundidade contra chamada malformada, e nao
 * recusa que alguem precise ler na tela: o tipo do documento vem de um enum
 * de `contracts` e o `userId` vem da sessao. Se uma delas disparar, e defeito
 * nosso — e defeito nosso deve virar 500 no log, nao mensagem amigavel que
 * esconde o problema. Mesmo criterio de `platform-admin-repository.ts`.
 */

type LinhaDeAceite = {
  readonly document_type: TipoDeDocumentoLegal
  readonly document_version: string
  readonly accepted_at: Date
}

export function createLegalConsentRepository(sql: Sql): LegalConsentRepository {
  return {
    async record(input) {
      await sql`
        SELECT legal_consent_record(
          ${input.userId}::uuid,
          ${input.type}::text,
          ${input.version}::text,
          ${input.ip ?? null}::text,
          ${input.userAgent ?? null}::text
        )
      `
    },

    async latestFor(userId) {
      const linhas = await sql<LinhaDeAceite[]>`
        SELECT document_type, document_version, accepted_at
          FROM legal_consent_latest(${userId}::uuid)
      `

      return linhas.map((l) => ({
        type: l.document_type,
        version: l.document_version,
        acceptedAt: l.accepted_at,
      }))
    },
  }
}
