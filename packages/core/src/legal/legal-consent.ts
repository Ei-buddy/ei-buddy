import {
  DOCUMENTOS_LEGAIS,
  VERSOES_LEGAIS,
  type PendenciasLegais,
  type TipoDeDocumentoLegal,
} from '@na-regua/contracts'
import type { UserId } from '../context.js'
import type { LegalConsentRepository } from '../ports/legal-consent-repository.js'

/**
 * Aceite e reaceite dos documentos legais — RF-02, RF-03.
 *
 * O calculo inteiro cabe numa frase: e' pendente o documento cuja versao
 * vigente e diferente da ultima que a pessoa aceitou. Quem nunca aceitou cai
 * no mesmo ramo de quem aceitou uma versao antiga, e isso e deliberado — para
 * a tela, os dois sao "precisa aceitar isto agora", e tratar separado so
 * criaria um segundo caminho para testar.
 */

export type LegalConsentDeps = {
  readonly legalConsents: LegalConsentRepository
}

/** De onde veio o aceite. Opcional: nem todo canal tem HTTP por baixo. */
export type OrigemDoAceite = {
  readonly ip?: string
  readonly userAgent?: string
}

/**
 * Registra o aceite das versoes VIGENTES do que ainda esta pendente.
 *
 * Uma linha por documento, e nao uma linha so cobrindo os dois: quando os
 * Termos mudarem sem a Politica mudar, so os Termos precisam de reaceite — e
 * um registro unico obrigaria a pessoa a reaceitar um texto que nao mudou.
 *
 * ## Por que so o pendente, e nao todos
 *
 * Quando so os Termos mudam, a tela diz "leia os Termos" — e gravar tambem um
 * aceite novo da Politica registraria um consentimento que ninguem pediu
 * naquele clique, com data de hoje, para um texto que a pessoa leu meses
 * atras. O registro tem que descrever o que aconteceu.
 *
 * No cadastro isto da no mesmo: quem nao aceitou nada tem os dois pendentes.
 *
 * Chamar sem nada pendente nao grava nada — e o desfecho certo para um clique
 * repetido, em vez de encher a trilha de linhas identicas.
 */
export async function recordLegalAcceptance(
  deps: LegalConsentDeps,
  userId: UserId,
  origem: OrigemDoAceite = {},
): Promise<void> {
  const { pendentes } = await pendingLegalAcceptance(deps, userId)

  for (const { type } of pendentes) {
    await deps.legalConsents.record({
      userId,
      type,
      version: VERSOES_LEGAIS[type],
      ...(origem.ip === undefined ? {} : { ip: origem.ip }),
      ...(origem.userAgent === undefined ? {} : { userAgent: origem.userAgent }),
    })
  }
}

/**
 * O que esta pessoa ainda precisa aceitar.
 *
 * Lista vazia = em dia. Quem chama decide o que fazer com a pendencia — a
 * decisao de BLOQUEAR ou apenas avisar e da tela, nao deste caso de uso.
 */
export async function pendingLegalAcceptance(
  deps: LegalConsentDeps,
  userId: UserId,
): Promise<PendenciasLegais> {
  const aceites = await deps.legalConsents.latestFor(userId)
  const porTipo = new Map<TipoDeDocumentoLegal, string>(aceites.map((a) => [a.type, a.version]))

  const pendentes = DOCUMENTOS_LEGAIS.filter(
    (type) => porTipo.get(type) !== VERSOES_LEGAIS[type],
  ).map((type) => {
    const antes = porTipo.get(type)
    return {
      type,
      version: VERSOES_LEGAIS[type],
      ...(antes === undefined ? {} : { versaoAceitaAntes: antes }),
    }
  })

  return { pendentes }
}
