/**
 * Recuperacao auxiliar — RF-102, ADR-0017, NR-120.
 *
 * ## O que esta porta promete, e o que ela nao promete
 *
 * Promete CANDIDATOS: dado "tem coca dois litro?", devolver os produtos cujo
 * texto mais se parece com isso, com o id de cada um. Nao promete resposta,
 * nem valor, nem certeza.
 *
 * Nao promete NUMERO. A ADR-0017 separa recuperar de saber: o trecho sugere
 * qual `productId` passar a tool; quanto custa, quanto tem e quanto deve vem
 * da tool -> `core` -> `domain`. Um trecho pode estar velho, e dado que pode
 * estar velho nao entra em conta de dinheiro.
 *
 * ## Por que o adapter nao aparece aqui
 *
 * A implementacao de hoje e semelhanca de escrita (trigrama). Amanha pode ser
 * vetorial. A porta fala de candidatos e relevancia, que e o que o caso de uso
 * precisa — se ela falasse de embedding ou de distancia de cosseno, trocar o
 * mecanismo seria refazer o desenho.
 */

export type TipoDeTrecho = 'product' | 'customer' | 'faq'

export type TrechoParaIndexar = {
  readonly companyId: string
  readonly kind: TipoDeTrecho
  /** O `products.id` / `customers.id`. Nulo em `faq`. */
  readonly refId: string | null
  /** O texto como a pessoa o reconheceria — nome, apelido, descricao. */
  readonly conteudo: string
  readonly atualizadoEm: Date
}

export type Candidato = {
  readonly kind: TipoDeTrecho
  readonly refId: string | null
  readonly conteudo: string
  /**
   * Entre 0 e 1, do menos ao mais parecido.
   *
   * Numero do MECANISMO, e nao do negocio: serve para ordenar e para cortar,
   * nunca para mostrar ao lojista. "87% de certeza" e uma precisao que a busca
   * nao tem.
   */
  readonly relevancia: number
}

export type RetrievalStore = {
  /**
   * Grava ou atualiza o trecho de uma coisa.
   *
   * Reindexar o mesmo produto ATUALIZA. Sem isso, renomear um produto deixaria
   * o nome antigo respondendo para sempre — e o lojista veria o assistente
   * sugerir um item que ele mesmo tinha corrigido.
   */
  indexar(trecho: TrechoParaIndexar): Promise<void>

  /** Tira da busca. Produto apagado nao pode continuar sendo sugerido. */
  remover(entrada: {
    readonly companyId: string
    readonly kind: TipoDeTrecho
    readonly refId: string
  }): Promise<void>

  /**
   * Os `k` mais parecidos com a consulta, do mais ao menos.
   *
   * `k` e obrigatorio e pequeno por desenho: o que vai ao modelo tem teto
   * (RNF-075), e um retrieve guloso troca qualidade por conta de tokens.
   */
  buscar(entrada: {
    readonly companyId: string
    readonly consulta: string
    readonly k: number
    /** Limita a um tipo. Ausente = todos. */
    readonly kind?: TipoDeTrecho | undefined
  }): Promise<readonly Candidato[]>
}
