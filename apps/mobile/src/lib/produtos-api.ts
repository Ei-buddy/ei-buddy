import { chamarApi } from './api'
import { centavosDoTexto } from './valor'
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
  descricao: string
  ean: string
  ncm: string
  /** Natureza da operacao — 5102 revenda comum, 5405 com ST ja recolhida. */
  cfop: string
  /** CSOSN, 3 digitos. */
  situacaoTributaria: string
  categoria: string
  fornecedor: string
  precoCusto: number
  precoVenda: number
  /** Saldo inicial — so no cadastro; depois, estoque muda por ajuste ou venda. */
  estoque: number
  estoqueMinimo: number
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
 * Cadastra ou edita o produto — RF-017, RF-019, os mesmos campos do web.
 *
 * Com `id`, edita (PATCH): o saldo nao vai, porque estoque muda por ajuste
 * com motivo (RF-124), e nao por edicao de cadastro. Campo fiscal em branco
 * nao vai: o produto vende, e a nota diz o que falta quando for emitida.
 */
export async function salvarProduto(
  dados: DadosProduto,
  id?: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const editando = id !== undefined
  const texto = (v: string) => v.trim()

  const r = await chamarApi<{ id: string }>(
    editando ? `/produtos/${encodeURIComponent(id)}` : '/produtos',
    {
      method: editando ? 'PATCH' : 'POST',
      body: {
        description: texto(dados.descricao),
        ...(dados.ean ? { barcode: dados.ean.replace(/\D/g, '') } : {}),
        ...(editando ? {} : { unitOfMeasure: 'un' }),
        /* A tela trabalha em reais; o contrato exige centavos inteiros
           (RNF-044). A conversao acontece AQUI, na borda. */
        salePriceCents: Math.round(dados.precoVenda * 100),
        costPriceCents: Math.round(dados.precoCusto * 100),
        ...(editando ? {} : { stock: Math.round(dados.estoque) }),
        minStock: Math.round(dados.estoqueMinimo),
        ...(texto(dados.categoria) === '' ? {} : { category: texto(dados.categoria) }),
        ...(texto(dados.fornecedor) === '' ? {} : { supplier: texto(dados.fornecedor) }),
        ...(texto(dados.ncm) === '' ? {} : { ncm: texto(dados.ncm) }),
        ...(texto(dados.cfop) === '' ? {} : { cfop: texto(dados.cfop) }),
        ...(texto(dados.situacaoTributaria) === ''
          ? {}
          : { taxSituationCode: texto(dados.situacaoTributaria) }),
      },
    },
  )

  if (!r.ok) return { ok: false, error: r.message }
  return { ok: true, id: editando ? id : r.dados.id }
}

/** Categorias e fornecedores que a loja ja usou — as sugestoes do formulario. */
export async function carregarSugestoes(): Promise<{
  categorias: string[]
  fornecedores: string[]
}> {
  const r = await chamarApi<{ categories: string[]; suppliers: string[] }>('/produtos/sugestoes')
  return r.ok
    ? { categorias: r.dados.categories, fornecedores: r.dados.suppliers }
    : { categorias: [], fornecedores: [] }
}

/* -------------------------------------------------------------------------- */
/* A ficha do produto — RF-017, RF-022, RF-023, RF-124                        */
/* -------------------------------------------------------------------------- */

export type ProdutoDaFicha = {
  id: string
  codigo: string
  descricao: string
  ean: string | null
  ncm: string | null
  cfop: string | null
  cst: string | null
  categoria: string | null
  fornecedor: string | null
  unidade: string
  precoVenda: number
  precoCusto: number
  estoque: number
  estoqueMinimo: number
  /** Inativo sai do PDV, mas fica no historico — NR-151. */
  ativo: boolean
}

export async function buscarProduto(
  produtoId: string,
): Promise<{ ok: true; dados: ProdutoDaFicha } | { ok: false; erro: string }> {
  const r = await chamarApi<{
    id: string
    internalCode: string
    description: string
    barcode: string | null
    ncm: string | null
    cfop: string | null
    taxSituationCode: string | null
    category: string | null
    supplier: string | null
    unitOfMeasure: string
    salePriceCents: number
    costPriceCents: number
    stock: number
    minStock: number
    isActive: boolean
  }>(`/produtos/${encodeURIComponent(produtoId)}`)
  if (!r.ok) return { ok: false, erro: r.message }

  const p = r.dados
  return {
    ok: true,
    dados: {
      id: p.id,
      codigo: p.internalCode,
      descricao: p.description,
      ean: p.barcode,
      ncm: p.ncm,
      cfop: p.cfop,
      cst: p.taxSituationCode,
      categoria: p.category,
      fornecedor: p.supplier,
      unidade: p.unitOfMeasure,
      precoVenda: p.salePriceCents / 100,
      precoCusto: p.costPriceCents / 100,
      estoque: p.stock,
      estoqueMinimo: p.minStock,
      ativo: p.isActive,
    },
  }
}

/** Inativar ou reativar — NR-151. O produto nao some: sai do PDV e da venda. */
export async function definirAtivo(
  produtoId: string,
  ativo: boolean,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const r = await chamarApi<unknown>(
    `/produtos/${encodeURIComponent(produtoId)}/${ativo ? 'reativar' : 'inativar'}`,
    { method: 'POST' },
  )
  return r.ok ? { ok: true } : { ok: false, erro: r.message }
}

export type CausaDoMovimento = 'adjustment' | 'sale' | 'sale_cancelled' | 'sale_returned'

export const ROTULO_DA_CAUSA: Record<CausaDoMovimento, string> = {
  adjustment: 'Ajuste',
  sale: 'Venda',
  sale_cancelled: 'Venda estornada',
  sale_returned: 'Devolução',
}

export type MovimentoDeEstoque = {
  id: string
  causa: CausaDoMovimento
  delta: number
  saldoDepois: number
  motivo: string | null
  quando: string
}

type MovimentoDaApi = {
  id: string
  kind: CausaDoMovimento
  quantityDelta: number
  balanceAfter: number
  reason: string | null
  createdAt: string
}

const paraMovimento = (m: MovimentoDaApi): MovimentoDeEstoque => ({
  id: m.id,
  causa: m.kind,
  delta: m.quantityDelta,
  saldoDepois: m.balanceAfter,
  motivo: m.reason,
  quando: m.createdAt,
})

/** O historico de movimentos do produto — RF-124, o mais recente primeiro. */
export async function carregarMovimentos(
  produtoId: string,
): Promise<{ ok: true; dados: MovimentoDeEstoque[] } | { ok: false; erro: string }> {
  const r = await chamarApi<{ movements: MovimentoDaApi[] }>(
    `/produtos/${encodeURIComponent(produtoId)}/movimentos`,
  )
  return r.ok
    ? { ok: true, dados: r.dados.movements.map(paraMovimento) }
    : { ok: false, erro: r.message }
}

/**
 * Ajusta o estoque pela CONTAGEM — RF-022, RF-124.
 *
 * Manda quanto ha na prateleira, e nao a diferenca: quem conta sabe o numero,
 * e a conta de quanto mudou quem faz e o servidor, contra o saldo atual.
 */
export async function ajustarEstoque(
  produtoId: string,
  contagem: number,
  motivo: string,
): Promise<{ ok: true; dados: MovimentoDeEstoque } | { ok: false; erro: string }> {
  const r = await chamarApi<MovimentoDaApi>(`/produtos/${encodeURIComponent(produtoId)}/estoque`, {
    method: 'POST',
    body: { countedQuantity: contagem, reason: motivo.trim() },
  })
  return r.ok ? { ok: true, dados: paraMovimento(r.dados) } : { ok: false, erro: r.message }
}

/** Os numeros do topo do catalogo, sobre a loja inteira e nao a pagina. */
export async function carregarResumoDoCatalogo(): Promise<{
  total: number
  abaixoDoMinimo: number
  esgotados: number
  valorEmEstoque: number
} | null> {
  const r = await chamarApi<{
    total: number
    belowMinimum: number
    outOfStock: number
    stockValueCents: number
  }>('/produtos/resumo')
  if (!r.ok) return null
  return {
    total: r.dados.total,
    abaixoDoMinimo: r.dados.belowMinimum,
    esgotados: r.dados.outOfStock,
    valorEmEstoque: r.dados.stockValueCents / 100,
  }
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
  /** O PDV leva o custo junto: o resumo da venda mostra a margem. */
  precoCusto: number
  estoque: number
  estoqueMinimo: number
  ativo: boolean
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
  /** Ausente = ativos, o padrao da api. O PDV nunca pede inativos — NR-151. */
  situacao?: 'ativos' | 'inativos'
}): Promise<
  | { ok: true; dados: { produtos: ProdutoDoCatalogo[]; total: number } }
  | { ok: false; erro: string }
> {
  const query = new URLSearchParams({ pageSize: String(ITENS_DO_CATALOGO) })
  if (opcoes.termo) query.set('q', opcoes.termo)
  if (opcoes.estoque && opcoes.estoque !== 'todos') query.set('stock', opcoes.estoque)
  if (opcoes.situacao) query.set('situacao', opcoes.situacao)

  const r = await chamarApi<{
    products: (ProdutoDaApi & {
      minStock: number
      category: string | null
      isActive: boolean
    })[]
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
        precoCusto: p.costPriceCents / 100,
        estoque: p.stock,
        estoqueMinimo: p.minStock,
        ativo: p.isActive,
      })),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Importacao — NR-072                                                        */
/* -------------------------------------------------------------------------- */

export type ResultadoDaImportacaoDeProdutos = {
  importados: number
  recusadas: { index: number; description: string; reason: string }[]
}

/** Inteiro da planilha: "12" ou "1.200"; nulo quando nao da para ler. */
function inteiroDaPlanilha(texto: string | undefined): number | null {
  const bruto = (texto ?? '').replace(/[^\d-]/g, '').trim()
  if (bruto === '') return null
  const n = Number(bruto)
  return Number.isInteger(n) ? n : null
}

/** Manda o lote para `POST /produtos/importacao`, como o web. */
export async function confirmarImportacaoProdutos(
  registros: Record<string, string>[],
): Promise<ResultadoDaImportacaoDeProdutos> {
  const recusadas: ResultadoDaImportacaoDeProdutos['recusadas'] = []
  const enviar: Record<string, unknown>[] = []
  const origem: number[] = []

  registros.forEach((r, index) => {
    const venda = centavosDoTexto(r.precoVenda)
    const custo = centavosDoTexto(r.precoCusto) ?? 0
    const descricao = (r.descricao ?? '').trim()
    if (descricao === '') {
      recusadas.push({ index, description: descricao, reason: 'Descrição vazia.' })
      return
    }
    if (venda === null) {
      recusadas.push({ index, description: descricao, reason: 'Preço de venda ilegível.' })
      return
    }
    const estoque = inteiroDaPlanilha(r.estoque)
    origem.push(index)
    enviar.push({
      description: descricao,
      unitOfMeasure: 'un',
      salePriceCents: venda,
      costPriceCents: custo,
      ...(r.ean?.trim() ? { barcode: r.ean.trim() } : {}),
      ...(r.ncm?.trim() ? { ncm: r.ncm.trim() } : {}),
      ...(estoque !== null ? { stock: estoque } : {}),
    })
  })

  if (enviar.length === 0) return { importados: 0, recusadas }

  const r = await chamarApi<{
    imported: number
    rejected: ResultadoDaImportacaoDeProdutos['recusadas']
  }>('/produtos/importacao', { method: 'POST', body: { products: enviar } })
  if (!r.ok) {
    return {
      importados: 0,
      recusadas: [
        ...recusadas,
        ...enviar.map((e, i) => ({
          index: origem[i] ?? i,
          description: String(e.description),
          reason: r.message,
        })),
      ],
    }
  }
  return {
    importados: r.dados.imported,
    recusadas: [
      ...recusadas,
      ...r.dados.rejected.map((rec) => ({ ...rec, index: origem[rec.index] ?? rec.index })),
    ],
  }
}
