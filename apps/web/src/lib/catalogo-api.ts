import { pedir, type Resultado } from './http'

/**
 * O catalogo do backoffice — NR-072, US-008.
 *
 * ## O que este modulo NAO tem, e por que
 *
 * O tipo `Produto` de `lib/types.ts` — o dos dados de exemplo — tem
 * `categoria`, `fornecedor` e `diasSemVenda`.
 *
 * `categoria` e `fornecedor` existem de verdade: `products.category` e
 * `products.supplier` sao texto livre (nao ha tabela `categories` nem
 * `suppliers` — sao etiquetas, nao entidades com cadastro proprio). O
 * fornecedor chegou depois: a coluna existia desde a migration 0007 e o
 * contrato de cadastro nunca a expunha, entao o lojista digitava e o dado
 * era descartado em silencio.
 *
 * `diasSemVenda` continua fora: sai das vendas, e nao do cadastro, e seria
 * uma agregacao propria. Um filtro sobre campo que o servidor nao tem e um
 * controle que mente: ele some da tela junto com o dado. Preferir manter
 * numero inventado seria trocar dado falso por rotulo falso.
 */

export type ProdutoDoCatalogo = {
  id: string
  /** Codigo interno, gerado quando nao ha codigo de barras — RF-019. */
  codigo: string
  descricao: string
  ean: string | null
  ncm: string | null
  /** Em reais: a api fala em centavos, a tela fala em reais. */
  precoVenda: number
  precoCusto: number
  estoque: number
  estoqueMinimo: number
  categoria: string | null
  fornecedor: string | null
  /** Inativo sai do PDV, mas fica no historico — NR-151. */
  ativo: boolean
}

export type NivelDeEstoque = 'todos' | 'baixo' | 'esgotado'

export type PaginaDoCatalogo = {
  produtos: ProdutoDoCatalogo[]
  /** Quantos casam com o filtro — NAO quantos vieram nesta pagina. */
  total: number
  page: number
  pageSize: number
}

export type ResumoDoCatalogo = {
  total: number
  /** Abaixo do minimo. INCLUI os zerados — ver o comentario em `ResumoStats`. */
  belowMinimum: number
  outOfStock: number
  stockValueCents: number
}

type ProdutoDaApi = {
  id: string
  description: string
  barcode: string | null
  internalCode: string
  ncm: string | null
  salePriceCents: number
  costPriceCents: number
  stock: number
  minStock: number
  category: string | null
  supplier: string | null
  isActive: boolean
}

const emReais = (centavos: number) => centavos / 100

const paraTela = (p: ProdutoDaApi): ProdutoDoCatalogo => ({
  id: p.id,
  codigo: p.internalCode,
  descricao: p.description,
  ean: p.barcode,
  ncm: p.ncm,
  precoVenda: emReais(p.salePriceCents),
  precoCusto: emReais(p.costPriceCents),
  estoque: p.stock,
  estoqueMinimo: p.minStock,
  categoria: p.category,
  fornecedor: p.supplier,
  ativo: p.isActive,
})

export type FiltroDoCatalogo = {
  termo: string
  estoque: NivelDeEstoque
  /** Ausente = ativos, o padrao da api — NR-151. */
  situacao?: 'ativos' | 'inativos'
  pagina: number
  porPagina: number
}

/**
 * Busca no SERVIDOR, e nao filtro sobre uma lista carregada.
 *
 * O catalogo de uma mercearia tem milhares de itens. Filtrar no navegador
 * exigiria traze-lo inteiro — e, pior, filtrar sobre a PAGINA daria respostas
 * erradas com cara de certas: "esgotados" mostraria os esgotados daqueles 24,
 * e nao os da loja.
 */
export async function carregarCatalogo(
  filtro: FiltroDoCatalogo,
): Promise<Resultado<PaginaDoCatalogo>> {
  const query = new URLSearchParams({
    stock: filtro.estoque,
    page: String(filtro.pagina),
    pageSize: String(filtro.porPagina),
  })

  if (filtro.situacao !== undefined) query.set('situacao', filtro.situacao)

  /* Termo vazio nao viaja: e "me mostre o catalogo", nao "ache nada". */
  const termo = filtro.termo.trim()
  if (termo !== '') query.set('q', termo)

  const r = await pedir<{
    products: ProdutoDaApi[]
    total: number
    page: number
    pageSize: number
  }>(`/api/produtos/catalogo?${query.toString()}`)

  return r.ok
    ? {
        ok: true,
        dados: {
          produtos: r.dados.products.map(paraTela),
          total: r.dados.total,
          page: r.dados.page,
          pageSize: r.dados.pageSize,
        },
      }
    : r
}

/** Os numeros do topo, sobre o catalogo inteiro — nunca somados da pagina. */
/** Inativar ou reativar — NR-151. O produto nao some: sai do PDV e da venda. */
export const definirAtivo = (id: string, ativo: boolean): Promise<Resultado<unknown>> =>
  pedir(`/api/produtos/${encodeURIComponent(id)}/${ativo ? 'reativar' : 'inativar'}`, {
    method: 'POST',
  })

export const carregarResumoDoCatalogo = (): Promise<Resultado<ResumoDoCatalogo>> =>
  pedir('/api/produtos/resumo')

/* -------------------------------------------------------------------------- */
/* A ficha do produto — RF-017, RF-022, RF-023, RF-124                        */
/* -------------------------------------------------------------------------- */

/**
 * O que a ficha mostra alem da lista: unidade e os campos fiscais.
 *
 * Nao estao em `ProdutoDoCatalogo` de proposito — a lista tem 24 cartoes e nao
 * cabe NCM, CFOP e CST em cada um. Carregar campo que a tela nao desenha e
 * peso de rede que ninguem ve.
 */
export type ProdutoDaFicha = ProdutoDoCatalogo & {
  unidade: string
  cfop: string | null
  /** Codigo de situacao tributaria. Nulo ate o lojista informar — RF-046. */
  cst: string | null
}

type FichaDaApi = ProdutoDaApi & {
  unitOfMeasure: string
  cfop: string | null
  taxSituationCode: string | null
}

export async function buscarProduto(id: string): Promise<Resultado<ProdutoDaFicha>> {
  const r = await pedir<FichaDaApi>(`/api/produtos/${encodeURIComponent(id)}`)

  return r.ok
    ? {
        ok: true,
        dados: {
          ...paraTela(r.dados),
          unidade: r.dados.unitOfMeasure,
          cfop: r.dados.cfop,
          cst: r.dados.taxSituationCode,
        },
      }
    : r
}

/**
 * A causa do movimento, e nao entrada/saida — RF-124.
 *
 * Separar `sale` de `adjustment` e o que permite responder "quanto sumiu por
 * divergencia este mes?" sem cruzar com venda. Entrada e saida respondem o
 * quanto, e nunca o porque — e e o porque que faz alguem agir.
 */
export type CausaDoMovimento =
  'adjustment' | 'sale' | 'sale_cancelled' | 'sale_returned' | 'purchase'

export type MovimentoDeEstoque = {
  id: string
  causa: CausaDoMovimento
  /** Assinado: negativo tira do saldo, positivo devolve. */
  delta: number
  /** Saldo depois deste movimento — dispensa refazer a soma para conferir. */
  saldoDepois: number
  motivo: string | null
  saleId: string | null
  /** ISO 8601 com hora: dois ajustes no mesmo dia precisam de ordem visivel. */
  quando: string
}

type MovimentoDaApi = {
  id: string
  kind: CausaDoMovimento
  quantityDelta: number
  balanceAfter: number
  reason: string | null
  saleId: string | null
  createdAt: string
}

/**
 * A trilha do produto, da mais recente para tras.
 *
 * Vinha de um objeto literal em `produtos-api` com quatro movimentos fixos
 * para `prod-1` — a tela mostrava a mesma historia de agosto para qualquer
 * loja, e produto nenhum fora daquela lista tinha historico.
 */
export async function carregarMovimentos(
  produtoId: string,
): Promise<Resultado<MovimentoDeEstoque[]>> {
  const r = await pedir<{ movements: MovimentoDaApi[] }>(
    `/api/produtos/${encodeURIComponent(produtoId)}/movimentos`,
  )

  return r.ok
    ? {
        ok: true,
        dados: r.dados.movements.map((m) => ({
          id: m.id,
          causa: m.kind,
          delta: m.quantityDelta,
          saldoDepois: m.balanceAfter,
          motivo: m.reason,
          saleId: m.saleId,
          quando: m.createdAt,
        })),
      }
    : r
}

/**
 * Ajuste de inventario — RF-023.
 *
 * Manda a contagem ABSOLUTA, e nao a diferenca: o lojista contou dezoito,
 * entao sao dezoito. Calcular o delta aqui obrigaria a tela a subtrair de um
 * saldo que pode ter mudado entre a leitura e o envio — e o ajuste existe
 * justamente porque se desconfia daquele numero.
 *
 * Ate agora esta funcao era `await delay(700)` e um `return { ok: true }`. A
 * tela dizia "Ajuste registrado no historico" e nada era gravado: o lojista
 * corrigia a contagem, via a confirmacao, e o saldo continuava errado.
 */
export async function ajustarEstoque(
  produtoId: string,
  contagem: number,
  motivo: string,
): Promise<Resultado<MovimentoDeEstoque>> {
  const r = await pedir<MovimentoDaApi>(`/api/produtos/${encodeURIComponent(produtoId)}/estoque`, {
    method: 'POST',
    body: JSON.stringify({ countedQuantity: contagem, reason: motivo }),
  })

  return r.ok
    ? {
        ok: true,
        dados: {
          id: r.dados.id,
          causa: r.dados.kind,
          delta: r.dados.quantityDelta,
          saldoDepois: r.dados.balanceAfter,
          motivo: r.dados.reason,
          saleId: r.dados.saleId,
          quando: r.dados.createdAt,
        },
      }
    : r
}
