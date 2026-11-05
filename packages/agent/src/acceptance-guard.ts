import type { ResumoDeEntidades } from './conversation-context.js'

/**
 * A trava do aceite — FR-015, FR-016.
 *
 * O modelo interpreta a resposta da dona, mas quem decide se ela PODE virar
 * gravação é esta função, sobre o texto que a dona mandou (nunca sobre um
 * argumento do modelo). Concordância pura passa; qualquer dado novo ou
 * ressalva barra, e o caminho vira correção com nova proposta.
 *
 * É a única barreira de código entre o que o modelo entende e o banco.
 */

const MAXIMO_DE_PALAVRAS = 6

const VALOR = /\b(r\$|reais|real|conto|contos)\b|r\$/
const PAGAMENTO = /\b(pix|dinheiro|debito|credito|cartao|fiado)\b/
const RESSALVA = /\b(mas|porem|ne|acho|sera|talvez|nao|troca|muda|altera|so que)\b/

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

function palavras(texto: string): string[] {
  return texto.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p))
}

export function ehConcordanciaPura(texto: string, resumo: ResumoDeEntidades): boolean {
  const t = normalizar(texto)
  if (t === '') return false
  if (/\d/.test(t)) return false
  if (t.includes('?')) return false
  if (VALOR.test(t) || PAGAMENTO.test(t) || RESSALVA.test(t)) return false
  if (palavras(t).length > MAXIMO_DE_PALAVRAS) return false

  for (const e of resumo.entidades) {
    const rotulo = normalizar(e.rotulo)
    if (rotulo.length >= 2 && t.includes(rotulo)) return false
    for (const parte of palavras(rotulo)) {
      if (parte.length >= 3 && new RegExp(`\\b${parte}\\b`).test(t)) return false
    }
  }
  return true
}
