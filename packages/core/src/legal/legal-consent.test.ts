import { VERSOES_LEGAIS } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { InMemoryLegalConsentRepository } from './fakes.js'
import { pendingLegalAcceptance, recordLegalAcceptance } from './legal-consent.js'

/**
 * Aceite e reaceite — RF-02, RF-03, LGPD art. 8 §1.
 *
 * O que se garante aqui e a regra que o checkbox sozinho nunca deu: existe
 * PROVA de que a pessoa aceitou, de qual versao, e a prova antiga nao some
 * quando sai versao nova.
 */

const USUARIO = 'user-1'
const OUTRO = 'user-2'

function cenario() {
  const legalConsents = new InMemoryLegalConsentRepository()
  return { deps: { legalConsents }, legalConsents }
}

describe('consentimento dos documentos legais', () => {
  it('quem nunca aceitou tem os dois documentos pendentes', async () => {
    const c = cenario()

    const { pendentes } = await pendingLegalAcceptance(c.deps, USUARIO)

    expect(pendentes.map((p) => p.type).sort()).toEqual(['privacy', 'terms'])
    /* Sem aceite anterior, nao ha o que informar — e o campo fica fora. */
    expect(pendentes.every((p) => p.versaoAceitaAntes === undefined)).toBe(true)
  })

  it('depois de aceitar, nao sobra pendencia', async () => {
    const c = cenario()

    await recordLegalAcceptance(c.deps, USUARIO)

    expect((await pendingLegalAcceptance(c.deps, USUARIO)).pendentes).toEqual([])
  })

  it('grava a versao VIGENTE, e nao uma que o cliente escolheu', async () => {
    const c = cenario()

    await recordLegalAcceptance(c.deps, USUARIO)

    expect(c.legalConsents.registros.map((r) => r.version)).toEqual([
      VERSOES_LEGAIS.privacy,
      VERSOES_LEGAIS.terms,
    ])
  })

  it('guarda IP e user agent como prova de consentimento', async () => {
    const c = cenario()

    await recordLegalAcceptance(c.deps, USUARIO, { ip: '200.0.0.1', userAgent: 'Firefox' })

    expect(c.legalConsents.registros[0]?.ip).toBe('200.0.0.1')
    expect(c.legalConsents.registros[0]?.userAgent).toBe('Firefox')
  })

  it('sem IP e sem user agent continua sendo aceite valido', async () => {
    const c = cenario()

    await recordLegalAcceptance(c.deps, USUARIO)

    /* Canal sem HTTP nao inventa um IP so para preencher a coluna. */
    expect(c.legalConsents.registros[0]?.ip).toBeUndefined()
    expect((await pendingLegalAcceptance(c.deps, USUARIO)).pendentes).toEqual([])
  })

  it('versao nova de UM documento pede reaceite so dele', async () => {
    const c = cenario()
    await recordLegalAcceptance(c.deps, USUARIO)

    /* Simula a publicacao de Termos novos: a Politica nao mudou. */
    await c.legalConsents.record({ userId: USUARIO, type: 'terms', version: 'versao-antiga' })

    const { pendentes } = await pendingLegalAcceptance(c.deps, USUARIO)

    /* Obrigar a reaceitar a Politica que nao mudou seria pedir consentimento
       para um texto que a pessoa ja tinha aceitado — e treina a clicar sem ler. */
    expect(pendentes).toHaveLength(1)
    expect(pendentes[0]?.type).toBe('terms')
    expect(pendentes[0]?.version).toBe(VERSOES_LEGAIS.terms)
    expect(pendentes[0]?.versaoAceitaAntes).toBe('versao-antiga')
  })

  it('o reaceite grava SO o documento que mudou', async () => {
    const c = cenario()
    await recordLegalAcceptance(c.deps, USUARIO)
    await c.legalConsents.record({ userId: USUARIO, type: 'terms', version: 'versao-antiga' })

    await recordLegalAcceptance(c.deps, USUARIO)

    /*
     * Gravar tambem a Politica aqui registraria um consentimento que ninguem
     * deu naquele clique — com data de hoje, para um texto lido meses atras.
     */
    const daPolitica = c.legalConsents.registros.filter((r) => r.type === 'privacy')
    expect(daPolitica).toHaveLength(1)
    expect(c.legalConsents.registros.filter((r) => r.type === 'terms')).toHaveLength(3)
  })

  it('aceitar sem nada pendente nao grava linha repetida', async () => {
    const c = cenario()
    await recordLegalAcceptance(c.deps, USUARIO)

    await recordLegalAcceptance(c.deps, USUARIO)

    /* Clique repetido (ou dois dispositivos) nao enche a trilha de prova. */
    expect(c.legalConsents.registros).toHaveLength(2)
  })

  it('o aceite anterior NAO e apagado quando vem versao nova', async () => {
    const c = cenario()

    await c.legalConsents.record({ userId: USUARIO, type: 'terms', version: 'versao-antiga' })
    await recordLegalAcceptance(c.deps, USUARIO)

    /*
     * O coracao do RF-03. Se o aceite novo sobrescrevesse o antigo, a empresa
     * perderia a prova de que a pessoa concordou com o texto que valia na
     * epoca — que e justamente o que importa se alguem contestar um
     * tratamento feito no passado.
     */
    const doUsuario = c.legalConsents.registros.filter((r) => r.type === 'terms')
    expect(doUsuario.map((r) => r.version)).toEqual(['versao-antiga', VERSOES_LEGAIS.terms])
  })

  it('o aceite de uma pessoa nao vale pela outra', async () => {
    const c = cenario()

    await recordLegalAcceptance(c.deps, USUARIO)

    expect((await pendingLegalAcceptance(c.deps, OUTRO)).pendentes).toHaveLength(2)
  })
})
