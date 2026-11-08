/**
 * Os recortes de periodo das listas — vendas (NR-027) e orcamentos (NR-210).
 *
 * Saiu de dentro do historico de vendas quando os orcamentos precisaram do
 * mesmo filtro: duas copias seriam duas regras de "7 dias" para divergir.
 */

/** Em dias para tras a partir de hoje; 0 e qualquer periodo. */
export const PERIODOS = [
  { valor: 0, rotulo: 'Qualquer período' },
  { valor: 1, rotulo: 'Hoje e ontem' },
  { valor: 7, rotulo: '7 dias' },
  { valor: 30, rotulo: '30 dias' },
] as const

const dois = (n: number) => String(n).padStart(2, '0')

/** `AAAA-MM-DD` pelos campos LOCAIS da data. */
export const diaLocal = (d: Date) =>
  `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`

/**
 * `de`/`ate` para um recorte em dias.
 *
 * Campos LOCAIS, nunca `toISOString`: no fuso do Brasil a meia-noite de hoje
 * ainda e ontem em UTC, e o periodo comecaria um dia antes.
 */
export function periodoDe(dias: number, agora: Date = new Date()): { de: string; ate: string } {
  if (dias === 0) return { de: '', ate: '' }
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - (dias - 1))
  return { de: diaLocal(inicio), ate: diaLocal(agora) }
}
