import type {
  CatalogInput,
  CatalogOutput,
  CatalogSummaryOutput,
  CreateProductInput,
  ImportProductsInput,
  ImportProductsOutput,
  ImportRejection,
  ProductOutput,
  ProductSuggestionsOutput,
} from '@na-regua/contracts'
import { AppError, isAppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import { adjustStock } from '../inventory/adjust-stock.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { InventoryUnitOfWork } from '../ports/inventory-writers.js'
import type { ProductRepository } from '../ports/registration-repositories.js'
import type { RetrievalStore } from '../ports/retrieval.js'

export type RegisterProductDeps = {
  readonly products: ProductRepository
  /**
   * Indice de recuperacao — RF-102, ADR-0017, NR-120.
   *
   * Opcional: sem ele o cadastro funciona igual, e a busca aproximada
   * simplesmente nao acha nada. Uma funcionalidade a menos e melhor que um
   * cadastro que nao conclui — mesmo criterio de `SECRETS_KEY`.
   */
  readonly retrieval?: RetrievalStore | undefined
}

/**
 * O texto que representa o produto na busca — NR-120.
 *
 * Descricao, codigo interno e codigo de barras num campo so. Os dois codigos
 * entram porque o lojista tambem procura por eles: "o 0042" e um jeito comum
 * de se referir a um item sem embalagem.
 *
 * Preco e saldo NAO entram, e a ausencia e deliberada: o indice pode estar
 * velho, e dado velho perto de dinheiro e como um numero errado chega a uma
 * resposta (ADR-0017).
 */
function textoDeBusca(produto: ProductOutput): string {
  return [produto.description, produto.internalCode, produto.barcode]
    .filter((p): p is string => typeof p === 'string' && p !== '')
    .join(' ')
}

/**
 * Poe (ou atualiza) o produto no indice.
 *
 * Falha aqui NAO desfaz o cadastro, pelo mesmo desenho da semeadura do plano
 * de contas: o produto existe, visivel e utilizavel, e so a busca aproximada
 * fica sem ele ate a proxima reindexacao. Perder o cadastro por causa do
 * indice seria trocar o essencial pelo auxiliar.
 */
async function indexarProduto(
  deps: RegisterProductDeps,
  companyId: string,
  produto: ProductOutput,
  agora: Date,
): Promise<void> {
  if (deps.retrieval === undefined) return

  try {
    await deps.retrieval.indexar({
      companyId,
      kind: 'product',
      refId: produto.id,
      conteudo: textoDeBusca(produto),
      atualizadoEm: agora,
    })
  } catch {
    /* Silencio de proposito, e so aqui: o chamador pediu para cadastrar um
       produto, e ele foi cadastrado. */
  }
}

/**
 * Gera o codigo interno de um produto sem codigo de barras — RF-019.
 *
 * Formato `PROD-0001`, sequencial por empresa. Deliberadamente NAO e o id nem
 * um trecho de uuid: este codigo vai na etiqueta escrita a mao e e ditado no
 * telefone, entao precisa ser curto e sem caractere ambiguo. `a1b2c3` na
 * etiqueta de granel volta como `alb2c3`.
 *
 * A regra do formato vive aqui, em `core`, e nao no repositorio: quem informa o
 * fato (quantos produtos existem) e `db`; quem decide como o codigo se parece e
 * o nucleo.
 */
export function generateInternalCode(existingCount: number): string {
  return `PROD-${String(existingCount + 1).padStart(4, '0')}`
}

/**
 * Cadastra produto — RF-017, RF-018, RF-019.
 *
 * Com codigo de barras: procura antes de criar. Ler um EAN que ja existe e o
 * caso comum de reposicao, e criar um segundo cadastro deixaria a loja com dois
 * precos para o mesmo produto — que e como se descobre o problema, no dia em
 * que o caixa cobra o barato.
 */
export async function registerProduct(
  deps: RegisterProductDeps,
  ctx: ExecutionContext,
  input: CreateProductInput,
): Promise<ProductOutput> {
  assertCanWrite(ctx)

  if (input.barcode !== undefined) {
    const existente = await deps.products.findByBarcode(ctx.companyId, input.barcode)
    if (existente) {
      throw AppError.conflict(
        `Este codigo de barras ja esta em "${existente.description}". ` +
          'Edite o produto existente em vez de criar outro.',
      )
    }
  }

  /*
   * Codigo interno para todo produto, com ou sem codigo de barras: e por ele
   * que o lojista se refere ao item quando o leitor nao le — etiqueta amassada,
   * granel, produto sem embalagem.
   */
  const internalCode = generateInternalCode(await deps.products.countAll(ctx.companyId))

  const criado = await deps.products.create({
    companyId: ctx.companyId,
    description: input.description,
    barcode: input.barcode,
    internalCode,
    unitOfMeasure: input.unitOfMeasure,
    salePriceCents: input.salePriceCents,
    costPriceCents: input.costPriceCents,
    taxRate: input.taxRate,
    ncm: input.ncm ?? null,
    cfop: input.cfop ?? null,
    taxSituationCode: input.taxSituationCode ?? null,
    minStock: input.minStock,
    category: input.category,
    supplier: input.supplier,
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })

  await indexarProduto(deps, ctx.companyId, criado, ctx.now)

  return criado
}

/**
 * Localiza produto pelo codigo de barras lido — RF-018.
 *
 * Devolve `undefined` em vez de lancar: no PDV, "nao achei" e resposta normal
 * e leva a tela de cadastro (RF-017). Excecao aqui faria o caminho comum
 * passar por `catch`.
 */
export async function findProductByBarcode(
  deps: RegisterProductDeps,
  ctx: ExecutionContext,
  barcode: string,
): Promise<ProductOutput | undefined> {
  return deps.products.findByBarcode(ctx.companyId, barcode)
}

/**
 * A ficha de um produto — RF-017.
 *
 * LANCA quando nao acha, ao contrario de `findProductByBarcode`, e a diferenca
 * e de situacao: no PDV "nao achei este codigo" e resposta normal e leva ao
 * cadastro; abrir a ficha de um id que nao existe e um link quebrado, e a tela
 * precisa dizer isso em vez de desenhar um produto em branco.
 *
 * Produto de outra loja cai no mesmo erro, de proposito: distinguir "nao
 * existe" de "nao e seu" confirmaria, para quem varre ids, que aquele produto
 * existe em alguma outra loja.
 */
export async function getProduct(
  deps: RegisterProductDeps,
  ctx: ExecutionContext,
  productId: string,
): Promise<ProductOutput> {
  const produto = await deps.products.findById(ctx.companyId, productId)

  if (produto === undefined) {
    throw AppError.notFound('Produto nao encontrado.')
  }

  return produto
}

/**
 * O catalogo do balcao — RF-019.
 *
 * Leitura: nao passa por `assertCanWrite`. Quem vende precisa ver o que ha para
 * vender, e `accountant` consulta preco como qualquer um.
 *
 * O teto vive AQUI e nao na rota: ele e decisao de produto ("a tela mostra uma
 * lista, nao um banco"), e na rota cada cliente novo — mobile, assistente —
 * escolheria o seu. Quem pede pode reduzir; aumentar, nao.
 */
export const TETO_DO_CATALOGO = 50

export type SearchProductsDeps = {
  readonly products: ProductRepository
  /**
   * Recuperacao auxiliar — RF-102, ADR-0017, NR-120.
   *
   * Opcional: sem ela a busca funciona como sempre funcionou. Com ela, o
   * portugues de balcao passa a achar o produto.
   */
  readonly retrieval?: RetrievalStore | undefined
}

export async function searchProducts(
  deps: SearchProductsDeps,
  ctx: ExecutionContext,
  input: { readonly termo?: string; readonly limite?: number },
): Promise<readonly ProductOutput[]> {
  const limite = Math.min(input.limite ?? TETO_DO_CATALOGO, TETO_DO_CATALOGO)

  const termo = input.termo?.trim() ?? ''

  const achados = await deps.products.search(ctx.companyId, {
    /* Termo vazio e "me mostre o catalogo", nao "nao ache nada" — e o estado
       em que a tela do PDV abre. */
    ...(termo === '' ? {} : { termo }),
    limite: Math.max(1, limite),
  })

  /*
   * A recuperacao e AUXILIAR, e a palavra e literal: ela so entra quando a
   * busca normal nao achou nada.
   *
   * Nao e timidez. A busca do catalogo e exata e ordenada por criterio do
   * negocio; a recuperacao e aproximada e ordenada por semelhanca de escrita.
   * Deixar a segunda competir com a primeira faria "arroz" devolver "arroz
   * doce" antes do arroz — e o lojista perderia confianca no que ate entao
   * acertava.
   *
   * Termo vazio nao aciona: "me mostre o catalogo" nao e uma pergunta
   * ambigua.
   */
  if (achados.length > 0 || termo === '' || deps.retrieval === undefined) return achados

  return recuperarCandidatos(deps.retrieval, deps.products, ctx.companyId, termo, limite)
}

/**
 * Os produtos que a recuperacao sugeriu, carregados do catalogo — ADR-0017.
 *
 * O trecho recuperado da o `productId`; quem devolve o PRODUTO e o repositorio,
 * como sempre. E o ponto 2 da ADR-0017 em codigo: o indice sugere qual id
 * passar, e o dado sai da fonte de verdade.
 *
 * Por isso nada aqui usa o `conteudo` do trecho. Ele pode estar velho — o
 * nome pode ter mudado depois da ultima indexacao —, e devolver o texto do
 * indice faria o assistente falar de um produto que nao existe mais com aquele
 * nome.
 */
async function recuperarCandidatos(
  retrieval: RetrievalStore,
  products: ProductRepository,
  companyId: string,
  termo: string,
  limite: number,
): Promise<readonly ProductOutput[]> {
  const candidatos = await retrieval.buscar({
    companyId,
    consulta: termo,
    k: Math.max(1, limite),
    kind: 'product',
  })

  const carregados = await Promise.all(
    candidatos
      .map((c) => c.refId)
      .filter((id): id is string => id !== null)
      .map((id) => products.findById(companyId, id)),
  )

  /* Um trecho pode apontar para produto apagado entre a indexacao e agora.
     Some da lista em vez de virar erro: o lojista perguntou por um produto, e
     a resposta certa e o que ainda existe. */
  return carregados.filter((p): p is ProductOutput => p !== undefined)
}

/**
 * O catalogo do backoffice — NR-072, US-008.
 *
 * Leitura, sem `assertCanWrite`: `accountant` precisa ver o catalogo para
 * conferir custo, e exigir papel de escrita o deixaria de fora.
 *
 * `core` nao filtra nem ordena nada aqui. Nao e preguica: filtrar em memoria
 * exigiria trazer o catalogo inteiro para devolver 24 linhas, e o total — que
 * e o que faz a tela dizer "23 de 300" — nao existe sem contar no banco.
 */
export async function listCatalog(
  deps: SearchProductsDeps,
  ctx: ExecutionContext,
  input: CatalogInput,
): Promise<CatalogOutput> {
  const { produtos, total } = await deps.products.listCatalog(ctx.companyId, {
    ...(input.q === undefined || input.q === '' ? {} : { termo: input.q }),
    stock: input.stock,
    offset: (input.page - 1) * input.pageSize,
    limite: input.pageSize,
  })

  return { products: [...produtos], total, page: input.page, pageSize: input.pageSize }
}

/** Os numeros do topo da tela — sobre o catalogo inteiro, nao sobre a pagina. */
export async function catalogSummary(
  deps: SearchProductsDeps,
  ctx: ExecutionContext,
): Promise<CatalogSummaryOutput> {
  return deps.products.catalogSummary(ctx.companyId)
}

/**
 * Sugestoes do formulario de cadastro — categoria e fornecedor ja digitados
 * antes, e nao uma lista de exemplo fixa.
 *
 * Leitura, sem `assertCanWrite`: e a mesma politica do catalogo que a
 * alimenta.
 */
export async function productSuggestions(
  deps: SearchProductsDeps,
  ctx: ExecutionContext,
): Promise<ProductSuggestionsOutput> {
  const { categories, suppliers } = await deps.products.listSuggestions(ctx.companyId)
  return { categories: [...categories], suppliers: [...suppliers] }
}

export type ImportProductsDeps = RegisterProductDeps & {
  /**
   * O saldo inicial vira MOVIMENTO, e nao coluna escrita direto.
   *
   * O saldo e consequencia da trilha (RF-124). Um produto que nasce com 40
   * unidades e nao tem movimento explicando de onde elas vieram e um saldo que
   * a trilha nao fecha — e a trilha existe justamente para fechar.
   */
  readonly uow: InventoryUnitOfWork
  readonly audit: AuditTrail
}

/**
 * Cadastra o produto E grava o saldo inicial — RF-017, RF-124.
 *
 * `registerProduct` sozinho descarta o `stock` do contrato: o lojista digitava
 * 40 na tela e o produto nascia zerado, sem erro nenhum. So a importacao de
 * planilha lancava o saldo. Agora a tela, a planilha e o assistente passam
 * todos por aqui, e a regra e uma so.
 *
 * O saldo vira MOVIMENTO, e nao coluna — mesmo motivo de `ImportProductsDeps`.
 * Devolve o produto relido para que o `stock` da resposta seja o que ficou
 * gravado, e nao o zero de antes do movimento.
 */
export async function registerProductWithStock(
  deps: ImportProductsDeps,
  ctx: ExecutionContext,
  input: CreateProductInput,
  motivo = 'Saldo inicial do cadastro',
): Promise<ProductOutput> {
  const produto = await registerProduct(deps, ctx, input)

  /* Saldo inicial so quando ha saldo: movimento de zero unidade e ruido na
     trilha, e o CHECK do schema o recusa de qualquer jeito. */
  if (input.stock <= 0) return produto

  await adjustStock(deps, ctx, {
    productId: produto.id,
    countedQuantity: input.stock,
    reason: motivo,
  })

  return (await deps.products.findById(ctx.companyId, produto.id)) ?? produto
}

/**
 * Importacao de catalogo em lote — NR-072, US-008.
 *
 * ## Parcial, e uma linha por vez
 *
 * Cada linha entra ou e recusada por conta propria, e o resultado diz quantas
 * entraram e por que cada recusa aconteceu. Tudo-ou-nada faria uma planilha de
 * 300 produtos com um preco errado nao importar nenhum, e o lojista teria de
 * achar a linha, corrigir e mandar tudo de novo.
 *
 * ## Sequencial, e nao em paralelo
 *
 * `registerProduct` gera o codigo interno a partir da CONTAGEM de produtos da
 * empresa. Em paralelo, dez linhas leriam a mesma contagem e receberiam o mesmo
 * `PROD-0001` — nove falhariam no indice unico, e por um motivo que a mensagem
 * de erro nao explicaria. Em sequencia, cada uma conta o que a anterior gravou.
 *
 * ## Erro conhecido e erro desconhecido nao sao a mesma coisa
 *
 * `AppError` e recusa de negocio — codigo de barras repetido, preco abaixo do
 * custo — e vira uma linha do relatorio com a mensagem que o lojista precisa
 * ler. Qualquer outra excecao SOBE: banco fora do ar no meio de uma importacao
 * nao e "linha invalida", e transforma-la numa faria a tela dizer "298
 * importados, 2 ignorados" para um lote que na verdade parou.
 */
export async function importProducts(
  deps: ImportProductsDeps,
  ctx: ExecutionContext,
  input: ImportProductsInput,
): Promise<ImportProductsOutput> {
  /* Uma vez, no comeco: sem isto, quem nao pode escrever receberia 500 linhas
     recusadas pelo mesmo motivo em vez de uma negativa clara. */
  assertCanWrite(ctx)

  const rejected: ImportRejection[] = []
  let imported = 0

  for (const [index, linha] of input.products.entries()) {
    try {
      await registerProductWithStock(deps, ctx, linha, 'Saldo inicial da importacao de planilha')

      imported += 1
    } catch (erro) {
      if (!isAppError(erro)) throw erro

      rejected.push({ index, description: linha.description, reason: erro.message })
    }
  }

  return { imported, rejected }
}
