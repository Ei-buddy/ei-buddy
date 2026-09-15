import type { PendenciasLegais } from '@na-regua/contracts'
import { pedir, type Resultado } from './http'

/**
 * Documentos legais — RF-03.
 *
 * Só o reaceite passa por aqui. O TEXTO dos documentos é página do próprio
 * site (`/politica-de-privacidade`, `/termos-de-uso`), e não dado de API:
 * servir o texto por JSON só somaria um jeito a mais de a mesma cláusula ficar
 * diferente em dois lugares.
 */

export type VersoesLegais = { versoes: Record<string, string> }

/** As versões em vigor — o servidor é quem sabe, e não o pacote no navegador. */
export const buscarVersoesLegais = (): Promise<Resultado<VersoesLegais>> =>
  pedir('/api/legal/versoes')

export const buscarPendenciasLegais = (): Promise<Resultado<PendenciasLegais>> =>
  pedir('/api/legal/pendencias')

/** Registra o aceite das versões vigentes; devolve o que sobrou (nada, no caminho feliz). */
export const aceitarDocumentosLegais = (): Promise<Resultado<PendenciasLegais>> =>
  pedir('/api/legal/aceites', { method: 'POST', body: JSON.stringify({}) })
