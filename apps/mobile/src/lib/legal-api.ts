import { chamarApi, type Resposta } from './api'

/**
 * Documentos legais — RF-01, RF-03.
 *
 * ## Por que o app nao traz o texto dentro dele
 *
 * O TEXTO da Politica e dos Termos mora nas paginas do site, e a tela do
 * celular abre aquelas paginas no navegador. Embutir uma copia aqui criaria o
 * pior problema possivel para prova de consentimento: um aparelho com versao
 * antiga do aplicativo mostraria um texto que nao esta mais em vigor, e
 * registraria aceite dele. Com uma fonte so, quem le no celular le exatamente
 * o que esta publicado hoje.
 *
 * Por isso aqui so trafega METADADO — versao em vigor e o que falta aceitar.
 */

export type TipoDeDocumento = 'privacy' | 'terms'

export const ROTULO_DO_DOCUMENTO: Record<TipoDeDocumento, string> = {
  privacy: 'Politica de Privacidade',
  terms: 'Termos de Uso',
}

export const CAMINHO_DO_DOCUMENTO: Record<TipoDeDocumento, string> = {
  privacy: '/politica-de-privacidade',
  terms: '/termos-de-uso',
}

export const DOCUMENTOS: readonly TipoDeDocumento[] = ['privacy', 'terms']

export type PendenciaLegal = {
  readonly type: TipoDeDocumento
  readonly version: string
  readonly versaoAceitaAntes?: string
}

export const buscarVersoesLegais = (): Promise<Resposta<{ versoes: Record<string, string> }>> =>
  chamarApi('/legal/versoes')

export const buscarPendenciasLegais = (): Promise<Resposta<{ pendentes: PendenciaLegal[] }>> =>
  chamarApi('/legal/pendencias')

export const aceitarDocumentosLegais = (): Promise<Resposta<{ pendentes: PendenciaLegal[] }>> =>
  chamarApi('/legal/aceites', { method: 'POST', body: {} })
