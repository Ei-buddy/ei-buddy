import type { InvoiceItem, IssueInvoiceRequest } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { InvoiceQueue, ItemFiscalDaVenda, SaleFiscalReader } from '../ports/sale-fiscal.js'

/**
 * Pedir a nota de uma venda — NR-042, RF-045, RF-046.
 *
 * O gatilho que faltava: o emissor existia, a guarda existia, o consumidor da
 * fila existia, e nada os chamava.
 *
 * ## Enfileira, e nao emite
 *
 * A venda nao pode esperar a SEFAZ (RNF-004). Este caso de uso valida o que da
 * para validar aqui e poe o pedido na fila; quem fala com o provedor e o
 * worker, com espera crescente e fila de descarte.
 *
 * ## A pre-checagem e o coracao — RF-046
 *
 * Produto sem NCM, CFOP ou CST/CSOSN faz a SEFAZ recusar. Recusar aqui custa
 * nada; recusar la gasta transmissao, entra no historico do emitente e volta um
 * codigo numerico que ninguem le.
 *
 * E a mensagem NOMEIA os produtos. "Dados fiscais incompletos" manda o lojista
 * abrir um por um; "Cafe torrado 500g e Refrigerante 2L precisam de NCM" manda
 * ele direto aos dois. O cadastro deixa esses campos opcionais justamente
 * porque este momento existe.
 */

export type RequestInvoiceDeps = {
  readonly sales: SaleFiscalReader
  readonly queue: InvoiceQueue
}

/** A serie das notas de balcao. Uma so, ate haver motivo para mais. */
const SERIE_PADRAO = 1

/** Quantos nomes cabem na mensagem antes dela virar uma lista ilegivel. */
const NOMES_NA_MENSAGEM = 3

export async function requestInvoice(
  deps: RequestInvoiceDeps,
  ctx: ExecutionContext,
  input: { readonly saleId: string },
): Promise<{ readonly status: 'queued'; readonly saleId: string }> {
  assertCanWrite(ctx)

  const venda = await deps.sales.forInvoice(ctx.companyId, input.saleId)

  /* Venda de outra empresa responde como inexistente, nunca como proibida: 403
     confirmaria que ela existe. */
  if (venda === undefined) throw AppError.notFound('Venda não encontrada.')

  if (venda.items.length === 0) {
    throw AppError.validation('Esta venda não tem itens, e nota sem item não existe.')
  }

  const semClassificacao = venda.items.filter(naoClassificado)

  if (semClassificacao.length > 0) {
    throw AppError.validation(mensagemDeClassificacao(semClassificacao), [
      { path: 'items', message: 'Produto sem NCM, CFOP ou CST/CSOSN.' },
    ])
  }

  const request: IssueInvoiceRequest = {
    companyId: ctx.companyId,
    saleId: venda.saleId,
    series: SERIE_PADRAO,
    items: venda.items.map(paraItemDaNota),
    payments: venda.payments.map((p) => ({ method: p.method, amountCents: p.amountCents })),
    ...(venda.recipient === undefined ? {} : { recipient: venda.recipient }),
    requestedAt: ctx.now.toISOString(),
  }

  await deps.queue.enqueue(request)

  /*
   * "Na fila", e nao "emitida".
   *
   * Dizer "emitida" aqui seria mentir: a SEFAZ ainda nao viu a nota. A tela
   * mostra o estado de verdade e acompanha — RF-054 pede exatamente que o
   * estado fiscal seja explicito.
   */
  return { status: 'queued', saleId: venda.saleId }
}

const naoClassificado = (i: ItemFiscalDaVenda): boolean =>
  i.ncm === null || i.cfop === null || i.taxSituationCode === null

/**
 * A mensagem que manda o lojista ao lugar certo.
 *
 * Corta em tres nomes: uma venda de trinta itens sem classificacao viraria um
 * paragrafo que ninguem le, e o primeiro produto ja basta para ele entender o
 * que fazer.
 */
function mensagemDeClassificacao(itens: readonly ItemFiscalDaVenda[]): string {
  const nomes = itens.slice(0, NOMES_NA_MENSAGEM).map((i) => i.description)
  const resto = itens.length - nomes.length

  const lista = resto > 0 ? `${nomes.join(', ')} e mais ${resto}` : nomes.join(', ')

  return (
    `Falta classificacao fiscal em: ${lista}. ` +
    'Informe NCM, CFOP e CST/CSOSN no cadastro do produto para emitir a nota.'
  )
}

/**
 * O item da venda vira item da nota.
 *
 * `!` nos tres campos fiscais porque `naoClassificado` ja recusou os nulos —
 * chegar aqui com um deles vazio seria defeito de programacao, e nao entrada
 * invalida.
 */
const paraItemDaNota = (i: ItemFiscalDaVenda): InvoiceItem => ({
  /* Item sem produto (venda avulsa) usa o proprio id da linha como codigo: a
     nota exige um, e inventar "SEM-CODIGO" repetiria o mesmo valor em itens
     diferentes. */
  productId: i.productId ?? i.description,
  description: i.description,
  quantity: i.quantity,
  unitPriceCents: i.unitPriceCents,
  unitOfMeasure: i.unitOfMeasure,
  ncm: i.ncm!,
  cfop: i.cfop!,
  taxSituationCode: i.taxSituationCode!,
})
