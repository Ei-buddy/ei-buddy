import type { TipoDeDocumentoLegal } from '@na-regua/contracts'

/**
 * Rótulo e endereço de cada documento legal — lado do navegador.
 *
 * ## Por que não vem de `@na-regua/contracts`
 *
 * `apps/web` importa de `contracts` só TIPOS, que somem na compilação. O
 * pacote aponta para `src/index.ts` e seus imports internos usam extensão
 * `.js` (estilo TS/ESM): o bundler do Next não resolve isso, e importar um
 * VALOR de lá derruba a página inteira com "module not found". Foi
 * exatamente o que aconteceu ao escrever esta tela.
 *
 * O que fica duplicado aqui é só apresentação — rótulo em português e caminho
 * da página. A fonte da verdade do que importa (quais documentos existem e
 * qual VERSÃO está em vigor) continua no servidor, e chega por
 * `/api/legal/pendencias` e `/api/legal/versoes`.
 */

export const ROTULO_DO_DOCUMENTO: Record<TipoDeDocumentoLegal, string> = {
  privacy: 'Política de Privacidade',
  terms: 'Termos de Uso',
}

export const CAMINHO_DO_DOCUMENTO: Record<TipoDeDocumentoLegal, string> = {
  privacy: '/politica-de-privacidade',
  terms: '/termos-de-uso',
}

/** Ordem de exibição — a mesma das duas telas que listam os documentos. */
export const DOCUMENTOS: readonly TipoDeDocumentoLegal[] = ['privacy', 'terms']
