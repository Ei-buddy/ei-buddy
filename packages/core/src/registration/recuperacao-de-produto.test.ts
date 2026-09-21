import type { ProductOutput } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '../context.js'
import type { ProductRepository } from '../ports/registration-repositories.js'
import type { Candidato, RetrievalStore } from '../ports/retrieval.js'
import { searchProducts } from './register-product.js'

/**
 * A recuperacao auxiliar dentro da busca de produto — RF-102, ADR-0017.
 *
 * O que se prova aqui e QUANDO ela entra e o que ela devolve. Se ela acha o
 * produto certo e assunto do trigrama, e isso esta em `db`.
 */

const EMPRESA = '11111111-1111-4111-8111-111111111111'

const ctx = { companyId: EMPRESA, userId: 'u1', role: 'owner', channel: 'app' } as ExecutionContext

/* So os dois campos que as assercoes leem: o resto do ProductOutput nao
   participa do que se prova aqui. */
const produto = (id: string, description: string): ProductOutput =>
  ({ id, description }) as unknown as ProductOutput

function cenario(entrada: {
  buscaExata?: readonly ProductOutput[]
  candidatos?: readonly Candidato[]
  catalogo?: Record<string, ProductOutput>
}) {
  const consultas: string[] = []

  const products = {
    search: async () => entrada.buscaExata ?? [],
    findById: async (_c: string, id: string) => entrada.catalogo?.[id],
  } as unknown as ProductRepository

  const retrieval: RetrievalStore = {
    indexar: async () => undefined,
    remover: async () => undefined,
    buscar: async ({ consulta }) => {
      consultas.push(consulta)
      return entrada.candidatos ?? []
    },
  }

  return { deps: { products, retrieval }, consultas, products }
}

describe('quando a recuperacao entra', () => {
  it('NAO entra quando a busca exata ja achou', async () => {
    const c = cenario({
      buscaExata: [produto('p1', 'Arroz tipo 1')],
      candidatos: [{ kind: 'product', refId: 'p2', conteudo: 'Arroz doce', relevancia: 0.9 }],
    })

    const r = await searchProducts(c.deps, ctx, { termo: 'arroz' })

    /*
     * Deixar a aproximada competir com a exata faria "arroz" devolver "arroz
     * doce" antes do arroz — e o lojista perderia confianca no que ate entao
     * acertava.
     */
    expect(r.map((p) => p.id)).toEqual(['p1'])
    expect(c.consultas).toEqual([])
  })

  it('entra quando a busca exata voltou vazia', async () => {
    const c = cenario({
      buscaExata: [],
      candidatos: [
        { kind: 'product', refId: 'p9', conteudo: 'Coca-Cola 2 litros', relevancia: 0.8 },
      ],
      catalogo: { p9: produto('p9', 'Coca-Cola 2 litros') },
    })

    const r = await searchProducts(c.deps, ctx, { termo: 'coca 2l' })

    expect(r.map((p) => p.id)).toEqual(['p9'])
    expect(c.consultas).toEqual(['coca 2l'])
  })

  it('NAO entra com termo vazio — "me mostre o catalogo" nao e ambiguo', async () => {
    const c = cenario({ buscaExata: [] })

    await searchProducts(c.deps, ctx, { termo: '   ' })

    expect(c.consultas).toEqual([])
  })

  it('sem store configurado, a busca funciona como sempre', async () => {
    const products = {
      search: async () => [produto('p1', 'Arroz')],
      findById: async () => undefined,
    } as unknown as ProductRepository

    const r = await searchProducts({ products }, ctx, { termo: 'arroz' })

    expect(r.map((p) => p.id)).toEqual(['p1'])
  })
})

describe('o que a recuperacao devolve', () => {
  it('o PRODUTO do catalogo, e nao o texto do indice', async () => {
    const c = cenario({
      buscaExata: [],
      /* O indice ainda tem o nome antigo: foi indexado antes da correcao. */
      candidatos: [
        { kind: 'product', refId: 'p9', conteudo: 'Coca Cola dois litros', relevancia: 0.7 },
      ],
      catalogo: { p9: produto('p9', 'Coca-Cola 2 litros') },
    })

    const r = await searchProducts(c.deps, ctx, { termo: 'coca' })

    /* ADR-0017 ponto 2: o indice sugere qual id passar; o dado sai da fonte de
       verdade. Devolver o texto do indice faria o assistente falar de um
       produto com um nome que ele nao tem mais. */
    expect(r[0]?.description).toBe('Coca-Cola 2 litros')
  })

  it('candidato que aponta para produto apagado some da lista', async () => {
    const c = cenario({
      buscaExata: [],
      candidatos: [
        { kind: 'product', refId: 'sumiu', conteudo: 'Detergente', relevancia: 0.9 },
        { kind: 'product', refId: 'p9', conteudo: 'Coca-Cola', relevancia: 0.6 },
      ],
      catalogo: { p9: produto('p9', 'Coca-Cola 2 litros') },
    })

    const r = await searchProducts(c.deps, ctx, { termo: 'coca' })

    /* Entre indexar e agora, o produto pode ter sido apagado. A resposta certa
       e o que ainda existe, e nao um erro. */
    expect(r.map((p) => p.id)).toEqual(['p9'])
  })

  it('respeita o limite pedido', async () => {
    const c = cenario({ buscaExata: [], candidatos: [] })

    await searchProducts(c.deps, ctx, { termo: 'coca', limite: 3 })

    /* O teto de tokens do que vai ao modelo depende disso (RNF-075). */
    expect(c.consultas).toHaveLength(1)
  })
})
