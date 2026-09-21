/**
 * O texto como a busca o enxerga — NR-120.
 *
 * Sem acento, sem caixa, sem espaco sobrando. Tres passos banais que precisam
 * acontecer nos DOIS lados: em quem grava o trecho e em quem consulta. Se so
 * um normalizasse, "Sabão em pó" nunca encontraria "sabao em po" — e o
 * sintoma seria o assistente dizendo que o produto nao existe.
 *
 * ## Por que aqui, e nao no banco
 *
 * O `unaccent` do Postgres NAO e IMMUTABLE: ele depende do dicionario
 * carregado, e por isso nao entra em coluna gerada nem em indice. A saida
 * comum e embrulha-lo numa funcao marcada IMMUTABLE a mao — uma mentira ao
 * planejador, que volta como indice corrompido depois de um upgrade do
 * dicionario.
 *
 * Normalizar em codigo custa uma linha, nao mente para ninguem, e fica
 * testavel sem banco.
 */
export function normalizarParaBusca(texto: string): string {
  return (
    texto
      .normalize('NFD')
      /* Marcas de acento ficam como caracteres proprios depois do NFD. */
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  )
}
