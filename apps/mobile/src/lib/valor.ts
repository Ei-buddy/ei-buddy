/**
 * Valor em dinheiro digitado — a mesma regra de `apps/web/src/lib/valor.ts`.
 *
 * Copia, e nao import: o app e a web nao compartilham `lib`. O `paraCentavos`
 * que existia aqui apagava todo ponto antes de ler — "12.90" virava 1290
 * reais numa baixa.
 */

/**
 * Converte um valor digitado — na planilha ou no formulario — para centavos.
 *
 * Aceita "12,90", "12.90", "R$ 12,90" e "1.234,56" — sao todos formatos que
 * saem de planilha em pt-BR, e o lojista digita os mesmos na tela. Devolve
 * `null` quando nao da para ler, e nao zero: zero passaria como preco valido e
 * o produto entraria custando nada.
 */
export function centavosDoTexto(texto: string | undefined): number | null {
  const bruto = (texto ?? '').replace(/[^\d,.-]/g, '').trim()
  if (bruto === '') return null

  /*
   * A ULTIMA virgula ou ponto e o separador decimal; o resto e milhar. E o que
   * distingue "1.234,56" de "1.234" — no primeiro o ponto separa milhar, no
   * segundo tambem, e ler o ponto como decimal transformaria mil reais em um.
   */
  const ultimoSeparador = Math.max(bruto.lastIndexOf(','), bruto.lastIndexOf('.'))
  const temDecimal = ultimoSeparador >= 0 && bruto.length - ultimoSeparador - 1 <= 2

  const inteiro = temDecimal ? bruto.slice(0, ultimoSeparador) : bruto
  const decimal = temDecimal ? bruto.slice(ultimoSeparador + 1) : ''

  const numero = Number(`${inteiro.replace(/[.,]/g, '')}.${decimal.padEnd(2, '0') || '00'}`)

  return Number.isFinite(numero) ? Math.round(numero * 100) : null
}
