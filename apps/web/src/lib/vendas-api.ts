/**
 * ============================================================================
 * PONTOS DE INTEGRACAO — VENDAS / PDV
 * ============================================================================
 *
 *  | Funcao              | Endpoint esperado              | Disparo          |
 *  |---------------------|--------------------------------|------------------|
 *  | criarVenda          | POST /vendas                   | fim do carrinho  |
 *  | criarCobrancaVenda  | POST /vendas/:id/cobrancas     | etapa pagamento  |
 *  | statusCobrancaVenda | GET  /vendas/:id/cobrancas/:cid| polling          |
 *  | confirmarDinheiro   | POST /vendas/:id/pagamentos    | recebimento manual|
 *  | listarVendas        | GET  /vendas?de=&ate=          | historico        |
 *  | estornarVenda       | POST /vendas/:id/estorno       | estorno          |
 *
 * O SERVIDOR E QUEM FECHA A VENDA. O carrinho vive no navegador so ate o
 * fechamento; a partir dai, preco, imposto, taxa e estoque sao calculados
 * e gravados no servidor. Confiar no total que o front mandou permitiria
 * alterar preco pelo devtools.
 *
 * ESTORNO precisa ser transacional e cobrir tres coisas de uma vez:
 * devolver o item ao estoque, estornar o titulo em Contas a Receber e
 * cancelar a nota fiscal (ou emitir a de devolucao). Se uma falhar, nenhuma
 * pode valer — venda estornada com estoque nao devolvido vira furo de
 * inventario que ninguem consegue explicar depois.
 */

import { pedir } from './http'
import type { PixCharge, PixChargeStatus } from './auth-api'
import type { FormaPagamento } from './types'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Data de referencia do app. */
export const HOJE = '2026-08-24'

/* -------------------------------------------------------------------------- */
/* Carrinho                                                                   */
/* -------------------------------------------------------------------------- */

export type ItemCarrinho = {
  produtoId: string
  codigo: string
  descricao: string
  precoUnitario: number
  precoCusto: number
  quantidade: number
  estoqueDisponivel: number
}

export type TipoDesconto = 'percentual' | 'valor'

export type Desconto = {
  tipo: TipoDesconto
  /** Percentual (0-100) ou valor em reais, conforme o tipo. */
  quantia: number
}

export function subtotalItem(item: ItemCarrinho): number {
  return item.precoUnitario * item.quantidade
}

export function subtotalCarrinho(itens: ItemCarrinho[]): number {
  return itens.reduce((acc, i) => acc + subtotalItem(i), 0)
}

export function valorDesconto(subtotal: number, desconto: Desconto | null): number {
  if (!desconto || desconto.quantia <= 0) return 0

  const bruto =
    desconto.tipo === 'percentual' ? (subtotal * desconto.quantia) / 100 : desconto.quantia

  /* Nunca deixa o desconto passar do subtotal — total negativo nao existe. */
  return Math.min(bruto, subtotal)
}

export function totalCarrinho(itens: ItemCarrinho[], desconto: Desconto | null): number {
  const sub = subtotalCarrinho(itens)
  return sub - valorDesconto(sub, desconto)
}

export function paraItemCarrinho(produto: {
  id: string
  codigo: string
  descricao: string
  precoVenda: number
  precoCusto: number
  estoque: number
}): ItemCarrinho {
  return {
    produtoId: produto.id,
    codigo: produto.codigo,
    descricao: produto.descricao,
    precoUnitario: produto.precoVenda,
    precoCusto: produto.precoCusto,
    quantidade: 1,
    estoqueDisponivel: produto.estoque,
  }
}

/**
 * Busca pelo EAN lido na camera — RF-018, agora contra a api.
 *
 * `null` significa "a loja nao tem esse cadastro", e nao "erro": o balcao
 * distingue os dois, porque o primeiro tem conserto imediato (cadastrar) e o
 * segundo nao.
 */
export async function buscarPorEan(ean: string): Promise<ProdutoDoCatalogo | null> {
  const limpo = ean.replace(/\D/g, '')
  if (limpo === '') return null

  let resposta: Response
  try {
    resposta = await fetch(`/api/produtos?ean=${encodeURIComponent(limpo)}`, {
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
    })
  } catch {
    return null
  }

  if (!resposta.ok) return null

  const p = (await resposta.json().catch(() => null)) as {
    id: string
    description: string
    barcode: string | null
    internalCode: string
    salePriceCents: number
    costPriceCents: number
    stock: number
  } | null

  if (p === null) return null

  return {
    id: p.id,
    codigo: p.internalCode,
    descricao: p.description,
    ean: p.barcode,
    precoVenda: p.salePriceCents / 100,
    precoCusto: p.costPriceCents / 100,
    estoque: p.stock,
  }
}

/* -------------------------------------------------------------------------- */
/* Pagamento                                                                  */
/* -------------------------------------------------------------------------- */

export const FORMAS: {
  valor: FormaPagamento
  rotulo: string
  /** Taxa da operadora, em % — descontada do valor liquido. */
  taxa: number
  /**
   * Abre cobranca com QR para o cliente pagar — nenhuma forma, por enquanto.
   *
   * No balcao o pagamento e REGISTRADO (ADR-0004: o Asaas nao tem captura
   * presencial). Cartao passa na maquininha; Pix cai na chave do lojista; o
   * operador confirma quando ve o dinheiro. A cobranca Pix com QR dinamico
   * do PDV ainda e simulada (`criarCobrancaVenda`), e sem o botao de
   * demonstracao, que nao existe em producao, uma venda em Pix nunca
   * fechava. Volta a ser `true` quando a cobranca real existir.
   */
  online: boolean
}[] = [
  { valor: 'dinheiro', rotulo: 'Dinheiro', taxa: 0, online: false },
  { valor: 'pix', rotulo: 'Pix', taxa: 0.99, online: false },
  { valor: 'debito', rotulo: 'Débito', taxa: 1.99, online: false },
  { valor: 'credito', rotulo: 'Crédito', taxa: 3.49, online: false },
  { valor: 'carteira', rotulo: 'Carteira', taxa: 0, online: false },
]

export type Pagamento = {
  id: string
  forma: FormaPagamento
  valor: number
  status: 'pendente' | 'confirmado' | 'falhou'
  /** So no credito. Ausente = a vista. */
  parcelas?: number
}

/** Ate quantas vezes o balcao parcela no credito — a tabela da api cobre 1x a 12x. */
export const PARCELAS_MAXIMAS = 12

/**
 * Taxa estimada do credito por numero de parcelas, em %.
 *
 * A mesma escada da tabela padrao da api (`default-settings`): quem calcula o
 * liquido de verdade e o servidor. Aqui e so a previsao que o operador ve
 * antes de fechar, e parcelar tem de parecer mais caro na tela tambem.
 */
export function taxaDoCredito(parcelas: number): number {
  if (parcelas <= 1) return FORMAS.find((f) => f.valor === 'credito')?.taxa ?? 0
  if (parcelas === 2) return 5
  return 6 + (parcelas - 3) * 1.5
}

/** Taxa cobrada pela operadora sobre um pagamento. */
export function taxaDoPagamento(pagamento: Pagamento): number {
  const forma = FORMAS.find((f) => f.valor === pagamento.forma)
  if (!forma) return 0
  const taxa = pagamento.forma === 'credito' ? taxaDoCredito(pagamento.parcelas ?? 1) : forma.taxa
  return (pagamento.valor * taxa) / 100
}

/**
 * Valor que efetivamente entra em Contas a Receber: o pago menos a taxa
 * da operadora. E este numero que precisa bater com o extrato — nao o
 * valor de venda.
 */
export function valorLiquido(pagamentos: Pagamento[]): number {
  return pagamentos
    .filter((p) => p.status === 'confirmado')
    .reduce((acc, p) => acc + p.valor - taxaDoPagamento(p), 0)
}

/** SUBSTITUIR POR: POST /vendas/:id/cobrancas */
export async function criarCobrancaVenda(valor: number): Promise<PixCharge> {
  await delay(800)

  const chargeId = `vch-${Math.random().toString(36).slice(2, 10)}`
  const payload = [
    '00020126580014BR.GOV.BCB.PIX0136',
    chargeId.padEnd(36, '0'),
    '52040000530398654',
    valor.toFixed(2).padStart(6, '0'),
    '5802BR5913EI BUDDY LTDA6008CURITIBA62070503***6304',
  ].join('')

  return {
    chargeId,
    payload,
    expiresAt: Date.now() + 15 * 60_000,
    amount: valor,
    planName: 'Venda',
  }
}

/** SUBSTITUIR POR: GET /vendas/:id/cobrancas/:cid */
export async function statusCobrancaVenda(chargeId: string): Promise<PixChargeStatus> {
  await delay(400)
  void chargeId
  return 'pending'
}

/* -------------------------------------------------------------------------- */
/* Fechamento da venda                                                        */
/* -------------------------------------------------------------------------- */

export type DadosVenda = {
  clienteId: string | null
  clienteNome: string
  itens: ItemCarrinho[]
  desconto: Desconto | null
  pagamentos: Pagamento[]
}

/**
 * A forma de pagamento da tela para a do contrato.
 *
 * Traducao explicita, e nao um `as`: os dois vocabularios sao independentes —
 * a tela fala portugues com o lojista e a api fala o dominio. Um `as` calaria
 * o compilador no dia em que um dos lados ganhasse uma forma nova, e a venda
 * chegaria com um metodo que a api recusa.
 */
const METODO: Record<FormaPagamento, 'cash' | 'pix' | 'debit' | 'credit' | 'wallet'> = {
  dinheiro: 'cash',
  pix: 'pix',
  debito: 'debit',
  credito: 'credit',
  carteira: 'wallet',
}

/* O caminho de volta: a api devolve `cash` e a tela procura `dinheiro` em
   FORMAS. Sem isto o detalhe da venda mostrava "cash" cru. */
const FORMA_DO_METODO = Object.fromEntries(
  Object.entries(METODO).map(([forma, metodo]) => [metodo, forma]),
) as Record<string, FormaPagamento>

/** Reais para centavos. Arredondar aqui evita 1990.0000000000002 no corpo. */
const emCentavos = (reais: number): number => Math.round(reais * 100)

export type ResultadoDaVenda =
  | {
      ok: true
      id: string
      numero: string
      /**
       * A venda ja existia e foi reconhecida pela chave — RNF-043.
       *
       * A tela precisa saber: "venda registrada" depois de um reenvio faria o
       * operador achar que fechou duas.
       */
      reenvio: boolean
      /** Item vendido sem saldo — AVISO, nao erro (RF-028). */
      avisosDeEstoque: string[]
    }
  | { ok: false; error: string }

/**
 * Fecha a venda contra a api — RF-024 a RF-030.
 *
 * A `chaveDeIdempotencia` vem de fora de proposito (RNF-043): quem a gera e a
 * tela, UMA vez, quando o operador manda fechar. Gerada aqui dentro, cada
 * retentativa teria chave nova e a protecao viraria enfeite — o PDV com
 * internet ruim reenvia, e cada reenvio criaria uma venda, um estoque baixado e
 * um recebivel a mais.
 *
 * O total do front nao vai no corpo: quem calcula imposto, tarifa e liquido e o
 * servidor (RF-040, RF-036). Mandar o total daqui criaria dois lugares para a
 * mesma conta, e eles divergiriam na primeira mudanca de aliquota.
 */
export async function criarVenda(
  dados: DadosVenda,
  chaveDeIdempotencia: string,
): Promise<ResultadoDaVenda> {
  if (dados.itens.length === 0) {
    return { ok: false, error: 'O carrinho está vazio.' }
  }

  const subtotal = subtotalCarrinho(dados.itens)

  const corpo = {
    ...(dados.clienteId === null ? {} : { customerId: dados.clienteId }),
    items: dados.itens.map((i) => ({
      productId: i.produtoId,
      quantity: i.quantidade,
      unitPriceCents: emCentavos(i.precoUnitario),
    })),
    payments: dados.pagamentos.map((pg) => ({
      method: METODO[pg.forma],
      amountCents: emCentavos(pg.valor),
      /* 1x vai sem o campo: a vista e a ausencia de parcelamento no contrato. */
      ...(pg.forma === 'credito' && (pg.parcelas ?? 1) > 1 ? { installments: pg.parcelas } : {}),
    })),
    /* O desconto vai em CENTAVOS mesmo quando a tela o pediu em percentual: a
       api guarda o valor concedido, nao a regra que o produziu. */
    ...(dados.desconto === null
      ? {}
      : { discountCents: emCentavos(valorDesconto(subtotal, dados.desconto)) }),
  }

  let resposta: Response
  try {
    resposta = await fetch('/api/vendas', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': chaveDeIdempotencia },
      credentials: 'same-origin',
      body: JSON.stringify(corpo),
    })
  } catch {
    return { ok: false, error: 'Sem conexão. A venda não foi fechada — tente de novo.' }
  }

  const json = (await resposta.json().catch(() => ({}))) as {
    sale?: { id: string; number: number }
    stockWarnings?: string[]
    replayed?: boolean
    error?: { message?: string }
  }

  if (!resposta.ok || json.sale === undefined) {
    return { ok: false, error: json.error?.message ?? 'Não foi possível fechar a venda.' }
  }

  return {
    ok: true,
    id: json.sale.id,
    numero: String(json.sale.number),
    /* 200 e reenvio, 201 e venda nova — a api distingue os dois de proposito. */
    reenvio: resposta.status === 200 || json.replayed === true,
    avisosDeEstoque: json.stockWarnings ?? [],
  }
}

/* -------------------------------------------------------------------------- */
/* Documentos fiscais                                                         */
/* -------------------------------------------------------------------------- */

export type TipoNotaFiscal = 'nfce' | 'nfse'
export type EstadoEmissao = 'ocioso' | 'processando' | 'emitida' | 'erro'

export type NotaEmitida = {
  tipo: TipoNotaFiscal
  numero: string
  chave: string
  /** Link do DANFE/PDF devolvido pelo provedor. */
  url: string
  /** Impostos apurados, guardados para relatorio. */
  impostos: { nome: string; valor: number }[]
}

/**
 * Certificado digital da empresa — RF-004.
 *
 * A emissao depende dele. Esta consulta era `return 'ausente'` fixo: a tela
 * SEMPRE mandava cadastrar certificado, mesmo com um valido no banco, e o botao
 * de emitir nunca aparecia. Agora pergunta ao servidor.
 */
export type SituacaoCertificado = 'ausente' | 'valido' | 'expirado'

export async function situacaoCertificado(): Promise<SituacaoCertificado> {
  let resposta: Response
  try {
    resposta = await fetch('/api/empresa/credenciais-fiscais', {
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
    })
  } catch {
    /* Sem conexao, tratar como ausente leva o lojista a cadastrar de novo um
       certificado que ja existe. Mas deixar emitir tambem nao serve — a
       emissao falharia adiante. Ausente e o menos ruim, e a tela de Empresa
       mostra a verdade. */
    return 'ausente'
  }

  if (!resposta.ok) return 'ausente'

  const c = (await resposta.json().catch(() => ({}))) as {
    hasCertificate?: boolean
    certificateExpiresAt?: string | null
  }

  if (c.hasCertificate !== true) return 'ausente'

  /*
   * Comparacao em AAAA-MM-DD, e nao com `Date`: os dois lados sao data pura, e
   * converter para instante traria o fuso de volta ao problema — um certificado
   * que vence hoje viraria expirado as 21h no Brasil.
   */
  const hoje = new Date()
  const dois = (n: number) => String(n).padStart(2, '0')
  const hojeIso = `${hoje.getFullYear()}-${dois(hoje.getMonth() + 1)}-${dois(hoje.getDate())}`

  return (c.certificateExpiresAt ?? '') < hojeIso ? 'expirado' : 'valido'
}

/* -------------------------------------------------------------------------- */
/* Historico                                                                  */
/* -------------------------------------------------------------------------- */

export type VendaHistorico = {
  id: string
  numero: string
  data: string
  clienteNome: string
  itens: { descricao: string; quantidade: number; precoUnitario: number }[]
  subtotal: number
  desconto: number
  total: number
  pagamentos: { forma: FormaPagamento; valor: number }[]
  valorLiquido: number
  imposto: number
  nota: { tipo: TipoNotaFiscal; numero: string } | null
  status: 'concluida' | 'estornada'
}

/**
 * O historico de vendas — NR-027, US-021.
 *
 * Era `listarVendas()`, sincrona, devolvendo `lib/mock-data`: o lojista fechava
 * uma venda e o historico continuava sendo o de outra pessoa. Agora vem de
 * `GET /api/vendas/historico`, com filtro, periodo e paginacao no banco.
 *
 * O RESUMO vem junto e fala do filtro inteiro, nao da pagina. Somado no
 * navegador a partir das vinte vendas carregadas, o faturamento sairia varias
 * vezes menor assim que o historico passasse de uma pagina — e um numero que
 * parece certo e o pior tipo de errado.
 */
export type ItemDaVenda = {
  /** Nulo no item avulso: esse nao se devolve por produto. */
  produtoId: string | null
  descricao: string
  quantidade: number
  /** Ja devolvido em devolucoes anteriores — RF-044. */
  devolvido: number
  precoUnitario: number
  total: number
}

export type PagamentoDaVenda = {
  forma: FormaPagamento
  valor: number
  parcelas: number | null
}

export type VendaDoHistorico = {
  id: string
  numero: number
  data: string
  clienteId: string | null
  /** Nulo na venda de balcao sem identificacao — RF-033. */
  clienteNome: string | null
  status: 'open' | 'settled' | 'cancelled' | 'returned'
  bruto: number
  desconto: number
  /** O que o cliente pagou: bruto menos desconto. */
  total: number
  /** O que fica para a loja: sem imposto e sem tarifa de cartao. */
  liquido: number
  imposto: number
  taxaCartao: number
  /** Ja devolvido ao cliente, somando as devolucoes — RF-044. */
  devolvidoValor: number
  itens: ItemDaVenda[]
  pagamentos: PagamentoDaVenda[]
  notaNumero: number | null
  notaChave: string | null
}

export type ResumoDoHistorico = {
  quantidade: number
  faturamento: number
  liquido: number
  /** Nulo quando nao houve venda no filtro — nao zero. */
  ticketMedio: number | null
}

export type PaginaDoHistorico = {
  vendas: VendaDoHistorico[]
  total: number
  pagina: number
  porPagina: number
  resumo: ResumoDoHistorico
}

type VendaDaApi = {
  id: string
  number: number
  soldAt: string
  customerId: string | null
  customerName: string | null
  status: VendaDoHistorico['status']
  grossAmountCents: number
  discountCents: number
  netAmountCents: number
  taxAmountCents: number
  cardFeeAmountCents: number
  returnedAmountCents: number
  items: {
    productId: string | null
    description: string
    quantity: number
    returnedQuantity: number
    unitPriceCents: number
    totalCents: number
  }[]
  payments: { method: FormaPagamento; amountCents: number; installments: number | null }[]
  invoiceNumber: number | null
  invoiceAccessKey: string | null
}

const reais = (centavos: number) => centavos / 100

const vendaParaTela = (v: VendaDaApi): VendaDoHistorico => ({
  id: v.id,
  numero: v.number,
  data: v.soldAt,
  clienteId: v.customerId,
  clienteNome: v.customerName,
  status: v.status,
  bruto: reais(v.grossAmountCents),
  desconto: reais(v.discountCents),
  /* `netAmountCents` e o LIQUIDO (sem imposto e sem tarifa). Mostra-lo como
     total fazia a venda de R$ 28,90 aparecer como R$ 27,17. */
  total: reais(v.grossAmountCents - v.discountCents),
  liquido: reais(v.netAmountCents),
  imposto: reais(v.taxAmountCents),
  taxaCartao: reais(v.cardFeeAmountCents),
  devolvidoValor: reais(v.returnedAmountCents),
  itens: v.items.map((i) => ({
    produtoId: i.productId,
    descricao: i.description,
    quantidade: i.quantity,
    devolvido: i.returnedQuantity,
    precoUnitario: reais(i.unitPriceCents),
    total: reais(i.totalCents),
  })),
  pagamentos: v.payments.map((p) => ({
    forma: FORMA_DO_METODO[p.method] ?? (p.method as FormaPagamento),
    valor: reais(p.amountCents),
    parcelas: p.installments,
  })),
  notaNumero: v.invoiceNumber,
  notaChave: v.invoiceAccessKey,
})

export type FiltroDoHistorico = {
  termo: string
  /** AAAA-MM-DD, ou vazio para nao filtrar. */
  de: string
  ate: string
  pagina: number
  porPagina: number
}

export async function carregarHistorico(
  filtro: FiltroDoHistorico,
): Promise<{ ok: true; dados: PaginaDoHistorico } | { ok: false; error: string }> {
  const query = new URLSearchParams({
    page: String(filtro.pagina),
    pageSize: String(filtro.porPagina),
  })

  const termo = filtro.termo.trim()
  if (termo !== '') query.set('q', termo)
  if (filtro.de !== '') query.set('from', filtro.de)
  if (filtro.ate !== '') query.set('to', filtro.ate)

  let resposta: Response
  try {
    resposta = await fetch(`/api/vendas/historico?${query.toString()}`, {
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
    })
  } catch {
    return { ok: false, error: 'Sem conexão. Verifique sua internet.' }
  }

  const json = (await resposta.json().catch(() => ({}))) as {
    sales?: VendaDaApi[]
    total?: number
    page?: number
    pageSize?: number
    summary?: {
      salesCount: number
      grossCents: number
      netCents: number
      netAfterFeesCents: number
      averageTicketCents: number | null
    }
    error?: { message?: string }
  }

  if (!resposta.ok || json.sales === undefined || json.summary === undefined) {
    return { ok: false, error: json.error?.message ?? 'Não foi possível carregar o histórico.' }
  }

  return {
    ok: true,
    dados: {
      vendas: json.sales.map(vendaParaTela),
      total: json.total ?? 0,
      pagina: json.page ?? 1,
      porPagina: json.pageSize ?? 20,
      resumo: {
        quantidade: json.summary.salesCount,
        /* Faturamento e o bruto — o que os clientes pagaram. O liquido ja vem
           sem imposto e sem tarifa. */
        faturamento: reais(json.summary.grossCents),
        liquido: reais(json.summary.netAfterFeesCents),
        ticketMedio:
          json.summary.averageTicketCents === null ? null : reais(json.summary.averageTicketCents),
      },
    },
  }
}

/**
 * Estorna (cancela) a venda inteira — RF-043, NR-122.
 *
 * O servidor devolve os itens ao estoque e reverte o recebivel na mesma
 * transacao, e guarda o motivo. Ele RECUSA, com a mensagem de por que, venda
 * com nota emitida (cancele a nota antes), venda com recebimento ja baixado
 * (estorne a baixa antes) e venda ja cancelada — a mensagem vai direto para a
 * tela.
 *
 * Ate aqui esta funcao recusava sempre, com "ainda nao esta disponivel",
 * enquanto o caso de uso ja existia e o assistente ja o usava.
 */
export async function estornarVenda(
  id: string,
  motivo: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await pedir(`/api/vendas/${encodeURIComponent(id)}/cancelar`, {
    method: 'POST',
    body: JSON.stringify({ reason: motivo.trim() }),
  })
  return r.ok ? { ok: true } : { ok: false, error: r.erro }
}

/** O que a devolucao fez com o dinheiro, em reais. */
export type ResultadoDaDevolucao = {
  devolvido: number
  /** Sai do caixa: entregar ao cliente. */
  entregarAoCliente: number
  /** Estava em aberto (fiado, parcelas): so deixa de ser recebido. */
  deixaDeReceber: number
  venda: 'open' | 'settled' | 'returned'
}

/**
 * Devolve parte da venda — RF-044. A tela diz produtos e quantidades; o valor
 * quem calcula e o servidor, proporcional ao que foi cobrado por item.
 */
export async function devolverItens(
  id: string,
  motivo: string,
  itens: { produtoId: string; quantidade: number }[],
): Promise<{ ok: true; dados: ResultadoDaDevolucao } | { ok: false; error: string }> {
  const r = await pedir<{
    refundCents: number
    paidBackCents: number
    uncollectedCents: number
    status: ResultadoDaDevolucao['venda']
  }>(`/api/vendas/${encodeURIComponent(id)}/devolucao`, {
    method: 'POST',
    body: JSON.stringify({
      reason: motivo.trim(),
      items: itens.map((i) => ({ productId: i.produtoId, quantity: i.quantidade })),
    }),
  })
  if (!r.ok) return { ok: false, error: r.erro }
  return {
    ok: true,
    dados: {
      devolvido: reais(r.dados.refundCents),
      entregarAoCliente: reais(r.dados.paidBackCents),
      deixaDeReceber: reais(r.dados.uncollectedCents),
      venda: r.dados.status,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Catalogo do balcao — RF-019                                                */
/* -------------------------------------------------------------------------- */

export type ProdutoDoCatalogo = {
  id: string
  codigo: string
  descricao: string
  ean: string | null
  precoVenda: number
  precoCusto: number
  estoque: number
}

/**
 * Busca no SERVIDOR, e nao filtro sobre uma lista carregada.
 *
 * O catalogo de uma mercearia tem milhares de itens; traze-lo inteiro para
 * filtrar no navegador custa a primeira abertura da tela e piora com o
 * crescimento da loja — exatamente ao contrario do que deveria.
 *
 * Termo vazio devolve o comeco do catalogo, que e o estado em que o PDV abre.
 * Lista vazia e resposta legitima aqui: "nenhum produto com esse nome".
 */
export async function carregarCatalogo(
  termo: string,
): Promise<{ ok: true; produtos: ProdutoDoCatalogo[] } | { ok: false; error: string }> {
  const busca = termo.trim()

  let resposta: Response
  try {
    resposta = await fetch(
      busca === '' ? '/api/produtos' : `/api/produtos?q=${encodeURIComponent(busca)}`,
      {
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
      },
    )
  } catch {
    return { ok: false, error: 'Sem conexão. Verifique sua internet.' }
  }

  const json = (await resposta.json().catch(() => ({}))) as {
    products?: {
      id: string
      description: string
      barcode: string | null
      internalCode: string
      salePriceCents: number
      costPriceCents: number
      stock: number
    }[]
    error?: { message?: string }
  }

  if (!resposta.ok || json.products === undefined) {
    return { ok: false, error: json.error?.message ?? 'Não foi possível carregar o catálogo.' }
  }

  return {
    ok: true,
    /* Centavos para reais na borda: a tela de venda inteira trabalha em reais. */
    produtos: json.products.map((p) => ({
      id: p.id,
      codigo: p.internalCode,
      descricao: p.description,
      ean: p.barcode,
      precoVenda: p.salePriceCents / 100,
      precoCusto: p.costPriceCents / 100,
      estoque: p.stock,
    })),
  }
}

/* -------------------------------------------------------------------------- */
/* Emissao da nota — NR-042, RF-045, RF-054                                    */
/* -------------------------------------------------------------------------- */

export type EstadoDaNota =
  | { status: 'pending' }
  | { status: 'authorized'; accessKey: string; number: number; danfeUrl: string }
  | { status: 'contingency'; accessKey: string; number: number; reason: string }
  | { status: 'rejected'; rejection: { code: string; message: string } }

/**
 * Pede a nota da venda — RF-045.
 *
 * O servidor ENFILEIRA e responde 202: a venda nao espera a SEFAZ (RNF-004).
 * Por isso o retorno de sucesso e "na fila", e nao "emitida" — dizer emitida
 * aqui seria afirmar um documento que ainda nao existe.
 *
 * A recusa por classificacao (RF-046) chega com o NOME dos produtos que faltam,
 * e a tela mostra a mensagem inteira: e ela que manda o lojista ao lugar certo.
 */
export async function pedirNota(
  vendaId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let resposta: Response
  try {
    resposta = await fetch(`/api/vendas/${vendaId}/nota`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
    })
  } catch {
    return { ok: false, error: 'Sem conexão. A venda está registrada — tente a nota de novo.' }
  }

  if (resposta.ok) return { ok: true }

  const corpo = (await resposta.json().catch(() => ({}))) as { error?: { message?: string } }
  return { ok: false, error: corpo.error?.message ?? 'Não foi possível pedir a nota.' }
}

/** O estado fiscal da venda — RF-054. */
export async function estadoDaNota(vendaId: string): Promise<EstadoDaNota | null> {
  try {
    const r = await fetch(`/api/vendas/${vendaId}/nota`, {
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
    })
    if (!r.ok) return null
    return (await r.json()) as EstadoDaNota
  } catch {
    return null
  }
}

/**
 * Pede ao servidor que confira as notas em contingencia — RF-053.
 *
 * Silenciosa de proposito: e uma atualizacao de fundo, e falhar nela nao muda
 * nada do que o lojista veio fazer. O estado de cada nota continua vindo de
 * `estadoDaNota`.
 */
export async function reconciliarContingencia(): Promise<void> {
  await fetch('/api/vendas/notas/reconciliar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  }).catch(() => undefined)
}
