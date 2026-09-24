import { chamarApi } from './api'
/**
 * ============================================================================
 * PONTOS DE INTEGRACAO — MODULO DE PRODUTOS
 * ============================================================================
 *
 *  | Funcao                | Endpoint esperado                       | Disparo           |
 *  |-----------------------|------------------------------------------|-------------------|
 *  | buscarEan             | GET  /produtos/codigo-de-barras/:codigo | busca por EAN     |
 *  | salvarProduto         | POST/PUT /produtos[/:id]                | submit do form    |
 *  | ajustarEstoque        | POST /produtos/:id/ajustes              | ajuste manual     |
 *  | movimentacoesEstoque  | GET  /produtos/:id/movimentos           | historico         |
 *  | confirmarImportacao   | POST /produtos/importar                 | importar planilha |
 *
 * Busca assistida de NCM e importacao de XML de nota de compra NAO existem
 * aqui: nenhuma das duas tem requisito por tras (ver `produtos-api.ts` do
 * web), e a segunda nem faria sentido no mobile — quem esta no balcao com o
 * celular na mao esta vendendo, nao dando entrada em mercadoria.
 */

import type { Produto } from './types'

/* -------------------------------------------------------------------------- */
/* Consulta por EAN                                                           */
/* -------------------------------------------------------------------------- */

export type DadosEan = {
  descricao: string
  ncm: string
  categoria: string
}

export type EanResult = { ok: true; dados: DadosEan } | { ok: false; error: string }

/**
 * O que o leitor achou — RF-018.
 *
 * Tres desfechos, e a diferenca entre eles e o que a tela precisa saber:
 *
 * - `cadastrado`: o codigo JA e de um produto da loja. O mais util nao e
 *   cadastrar de novo, e abrir o que existe.
 * - `novo`: a loja nao tem esse codigo. Segue para o cadastro com o campo
 *   preenchido.
 * - `erro`: nao deu para perguntar.
 *
 * Antes isto devolvia `{ ok: false }` para "ja cadastrado", o que fazia a tela
 * mostrar mensagem de erro para o caso mais comum e mais util do balcao.
 */
export type LeituraDeCodigo =
  | {
      readonly situacao: 'cadastrado'
      readonly produtoId: string
      readonly descricao: string
      /** O produto como a api o conhece: e dele que o carrinho tira preco e saldo. */
      readonly produto: ProdutoLido
    }
  | { readonly situacao: 'novo'; readonly ean: string }
  | { readonly situacao: 'erro'; readonly mensagem: string }

export async function buscarEan(ean: string): Promise<LeituraDeCodigo> {
  const limpo = ean.replace(/\D/g, '')

  /* Confere antes de ir a rede: EAN tem 8, 12, 13 ou 14 digitos, e leitura
     truncada e comum quando a etiqueta esta amassada. */
  if (![8, 12, 13, 14].includes(limpo.length)) {
    return { situacao: 'erro', mensagem: 'Código de barras incompleto. Tente ler de novo.' }
  }

  const r = await chamarApi<ProdutoDaApi>(`/produtos/codigo-de-barras/${limpo}`)

  if (r.ok) {
    return {
      situacao: 'cadastrado',
      produtoId: r.dados.id,
      descricao: r.dados.description,
      produto: {
        id: r.dados.id,
        codigo: r.dados.internalCode,
        descricao: r.dados.description,
        precoVenda: r.dados.salePriceCents / 100,
        precoCusto: r.dados.costPriceCents / 100,
        estoque: r.dados.stock,
      },
    }
  }

  /* 404 aqui e resposta, nao falha: o codigo lido e de produto que a loja ainda
     nao cadastrou, que e exatamente o caminho de cadastrar. */
  if (r.status === 404) return { situacao: 'novo', ean: limpo }

  return { situacao: 'erro', mensagem: r.message }
}

/* -------------------------------------------------------------------------- */
/* Gravacao                                                                   */
/* -------------------------------------------------------------------------- */

export type DadosProduto = {
  id?: string
  codigo: string
  descricao: string
  ean: string
  ncm: string
  categoria: string
  fornecedor: string
  precoCusto: number
  precoVenda: number
  estoque: number
  estoqueMinimo: number
  imagem: string | null
}

type ProdutoDaApi = {
  id: string
  internalCode: string
  description: string
  salePriceCents: number
  costPriceCents: number
  stock: number
}

/** O minimo do produto que o balcao usa: preco, custo e saldo, em reais. */
export type ProdutoLido = {
  readonly id: string
  readonly codigo: string
  readonly descricao: string
  readonly precoVenda: number
  readonly precoCusto: number
  readonly estoque: number
}

/**
 * Cadastra o produto — RF-017, RF-019.
 *
 * **Fornecedor e imagem nao sao enviados.** Categoria vai como texto
 * (`category`) — o 0909 nao tem tabela `categories`. O contrato e `.strict()`.
 */
export async function salvarProduto(
  dados: DadosProduto,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const r = await chamarApi<ProdutoDaApi>('/produtos', {
    method: 'POST',
    body: {
      description: dados.descricao,
      ...(dados.ean ? { barcode: dados.ean.replace(/\D/g, '') } : {}),
      unitOfMeasure: 'un',
      /* A tela trabalha em reais; o contrato exige centavos inteiros
         (RNF-044). A conversao acontece AQUI, na borda. */
      salePriceCents: Math.round(dados.precoVenda * 100),
      costPriceCents: Math.round(dados.precoCusto * 100),
      minStock: Math.round(dados.estoqueMinimo),
      ...(dados.categoria.trim() === '' ? {} : { category: dados.categoria.trim() }),
    },
  })

  return r.ok ? { ok: true, id: r.dados.id } : { ok: false, error: r.message }
}

/* -------------------------------------------------------------------------- */
/* Utilitarios de tela                                                        */
/* -------------------------------------------------------------------------- */

export type NivelEstoque = 'normal' | 'baixo' | 'esgotado'

export function nivelEstoque(produto: Pick<Produto, 'estoque' | 'estoqueMinimo'>): NivelEstoque {
  if (produto.estoque <= 0) return 'esgotado'
  if (produto.estoque < produto.estoqueMinimo) return 'baixo'
  return 'normal'
}

/** Margem sobre o preco de venda, em porcentagem. */
export function calcularMargem(custo: number, venda: number): number | null {
  if (!venda || venda <= 0) return null
  return ((venda - custo) / venda) * 100
}

/* -------------------------------------------------------------------------- */
/* Catalogo                                                                   */
/* -------------------------------------------------------------------------- */

export type ProdutoDoCatalogo = {
  id: string
  codigo: string
  descricao: string
  categoria: string | null
  precoVenda: number
  estoque: number
  estoqueMinimo: number
}

export type FiltroDeEstoque = 'todos' | 'baixo' | 'esgotado'

/** Mais que a pagina da web: no celular a lista rola, e paginar por botao atrapalha. */
const ITENS_DO_CATALOGO = 100

/**
 * O catalogo da loja — RF-019, `GET /produtos/catalogo`.
 *
 * Busca e filtro de estoque no SERVIDOR. A lista vinha de `mock-data`, e o
 * lojista via produtos que a loja nao tem.
 */
export async function listarCatalogo(opcoes: {
  termo?: string
  estoque?: FiltroDeEstoque
}): Promise<
  | { ok: true; dados: { produtos: ProdutoDoCatalogo[]; total: number } }
  | { ok: false; erro: string }
> {
  const query = new URLSearchParams({ pageSize: String(ITENS_DO_CATALOGO) })
  if (opcoes.termo) query.set('q', opcoes.termo)
  if (opcoes.estoque && opcoes.estoque !== 'todos') query.set('stock', opcoes.estoque)

  const r = await chamarApi<{
    products: (ProdutoDaApi & { minStock: number; category: string | null })[]
    total: number
  }>(`/produtos/catalogo?${query.toString()}`)
  if (!r.ok) return { ok: false, erro: r.message }

  return {
    ok: true,
    dados: {
      total: r.dados.total,
      produtos: r.dados.products.map((p) => ({
        id: p.id,
        codigo: p.internalCode,
        descricao: p.description,
        categoria: p.category,
        precoVenda: p.salePriceCents / 100,
        estoque: p.stock,
        estoqueMinimo: p.minStock,
      })),
    },
  }
}
