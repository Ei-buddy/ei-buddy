import type { RestockOutput, RestockReason, RestockSuggestion } from '@na-regua/contracts'
import type { CompanyId, ExecutionContext } from '../context.js'

/** O produto que pode precisar de reposicao, com o que vendeu na janela. */
export type CandidatoAReposicao = {
  readonly productId: string
  readonly description: string
  readonly internalCode: string
  readonly unitOfMeasure: string
  readonly stock: number
  readonly minStock: number
  /** Vendido menos devolvido, em vendas nao canceladas, desde `since`. */
  readonly vendido: number
}

export type RestockQueries = {
  /**
   * Os produtos ativos que venderam desde `since`, ou que estao negativos, ou
   * abaixo do minimo — os unicos que podem ter sugestao.
   */
  candidates(companyId: CompanyId, since: string): Promise<readonly CandidatoAReposicao[]>
}

export type SuggestRestockDeps = { readonly restock: RestockQueries }

/** A janela: seis meses, como o QA pediu. */
export const MESES_DA_JANELA = 6

/** O dia, seis meses antes de `agora` (UTC). */
export function inicioDaJanela(agora: Date): string {
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()))
  d.setUTCMonth(d.getUTCMonth() - MESES_DA_JANELA)
  return d.toISOString().slice(0, 10)
}

/**
 * Quanto comprar de um produto — a regra do QA: "o que vendeu nos ultimos
 * seis meses / 6 − estoque; se maior que zero, apresentar".
 *
 * Arredonda para CIMA: ninguem compra 1,7 caixa, e arredondar para baixo
 * deixaria faltar. O minimo cadastrado e o estoque negativo continuam
 * valendo — o produto novo, que ainda nao vendeu, nao some da lista. Vence a
 * maior das tres.
 */
export function sugestaoDeReposicao(c: CandidatoAReposicao): {
  quantidade: number
  motivo: RestockReason
  media: number
} {
  const media = c.vendido / MESES_DA_JANELA
  const porVendas = c.vendido > 0 ? Math.max(0, Math.ceil(media - c.stock - 1e-9)) : 0
  const porMinimo = c.minStock > 0 && c.stock < c.minStock ? c.minStock - c.stock : 0
  const porNegativo = c.stock < 0 ? -c.stock : 0

  const opcoes: [number, RestockReason][] = [
    [porVendas, 'vendas'],
    [porMinimo, 'minimo'],
    [porNegativo, 'negativo'],
  ]
  /* Empate fica com a primeira: "vendas" explica melhor que "minimo". */
  const [quantidade, motivo] = opcoes.reduce((a, b) => (b[0] > a[0] ? b : a))
  return { quantidade, motivo, media: Math.round(media * 10) / 10 }
}

/**
 * Os produtos que precisam de reposicao, do que mais falta para o que menos.
 *
 * Leitura, sem `assertCanWrite`: o contador e quem mais consulta estoque.
 */
export async function suggestRestock(
  deps: SuggestRestockDeps,
  ctx: ExecutionContext,
): Promise<RestockOutput> {
  const since = inicioDaJanela(ctx.now)
  const candidatos = await deps.restock.candidates(ctx.companyId, since)

  const items: RestockSuggestion[] = []
  for (const c of candidatos) {
    const s = sugestaoDeReposicao(c)
    if (s.quantidade <= 0) continue
    items.push({
      productId: c.productId,
      description: c.description,
      internalCode: c.internalCode,
      unitOfMeasure: c.unitOfMeasure,
      stock: c.stock,
      minStock: c.minStock,
      soldLast6Months: c.vendido,
      monthlyAverage: s.media,
      suggestedQuantity: s.quantidade,
      reason: s.motivo,
    })
  }

  items.sort(
    (a, b) =>
      b.suggestedQuantity - a.suggestedQuantity || a.description.localeCompare(b.description),
  )
  return { since, items }
}
