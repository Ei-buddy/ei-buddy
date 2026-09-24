/**
 * ============================================================================
 * PONTOS DE INTEGRACAO — VENDAS / PDV
 * ============================================================================
 *
 * O que ja e de VERDADE — fala com a api que existe desde a NR-027/NR-042:
 *
 *  | Funcao                 | Endpoint                  | Disparo             |
 *  |------------------------|----------------------------|--------------------|
 *  | fecharVenda            | POST /sales                | fim do carrinho    |
 *  | listarHistoricoDeVendas| GET  /sales?...            | tela de vendas     |
 *  | situacaoCertificado    | GET  /empresa/credenciais-fiscais | etapa fiscal|
 *  | pedirNota              | POST /vendas/:id/nota      | etapa fiscal       |
 *  | estadoDaNota           | GET  /vendas/:id/nota      | polling da nota    |
 *  | reconciliarContingencia| POST /vendas/notas/reconciliar | abrir a etapa |
 *
 * O que AINDA NAO existe no backend, de proposito documentado (nao e so falta
 * de wiring): cobranca Pix avulsa (`criarCobrancaVenda`/`statusCobrancaVenda`,
 * depende do adapter Asaas da NR-044) e estorno de venda
 * (`estornarVenda` — precisa ser transacional em tres tabelas de uma vez, e
 * essa unidade de trabalho ainda nao foi escrita nem no web).
 *
 * O SERVIDOR E QUEM FECHA A VENDA. O carrinho vive no aparelho so ate o
 * fechamento; a partir dai, preco, imposto, taxa e estoque sao calculados
 * e gravados no servidor. Confiar no total que o app mandou permitiria
 * alterar preco por fora.
 */

import { produtos } from './mock-data'
/* Tipos da cobranca Pix. No web eles moravam no auth-api por causa da
   assinatura; aqui, como o mobile nao cobra mensalidade, o unico uso e a
   venda — entao vivem junto dela. */
export type PixCharge = {
  chargeId: string
  /** Payload "copia e cola" — vira o QR Code. */
  payload: string
  /** Timestamp (ms) em que o codigo expira. */
  expiresAt: number
  amount: number
}

export type PixChargeStatus = 'pending' | 'paid' | 'expired'
import { chamarApi } from './api'
import type { FormaPagamento, Produto } from './types'

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

export function paraItemCarrinho(produto: Produto): ItemCarrinho {
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

/** Busca produto pelo EAN lido na camera. */
export function produtoPorEan(ean: string): Produto | null {
  const limpo = ean.replace(/\D/g, '')
  return (
    produtos.find((p) => p.ean === limpo) ??
    produtos.find((p) => p.codigo.toUpperCase() === ean.trim().toUpperCase()) ??
    null
  )
}

/* -------------------------------------------------------------------------- */
/* Pagamento                                                                  */
/* -------------------------------------------------------------------------- */

export const FORMAS: {
  valor: FormaPagamento
  rotulo: string
  /** Taxa da operadora, em % — descontada do valor liquido. */
  taxa: number
  /** Precisa de QR para o cliente pagar — so o Pix. Cartao passa na maquininha. */
  online: boolean
}[] = [
  { valor: 'dinheiro', rotulo: 'Dinheiro', taxa: 0, online: false },
  { valor: 'pix', rotulo: 'Pix', taxa: 0.99, online: true },
  { valor: 'debito', rotulo: 'Débito', taxa: 1.99, online: false },
  { valor: 'credito', rotulo: 'Crédito', taxa: 3.49, online: false },
  { valor: 'carteira', rotulo: 'Carteira', taxa: 0, online: false },
]

export type Pagamento = {
  id: string
  forma: FormaPagamento
  valor: number
  status: 'pendente' | 'confirmado' | 'falhou'
}

/** Taxa cobrada pela operadora sobre um pagamento. */
export function taxaDoPagamento(pagamento: Pagamento): number {
  const forma = FORMAS.find((f) => f.valor === pagamento.forma)
  if (!forma) return 0
  return (pagamento.valor * forma.taxa) / 100
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
  }
}

/** SUBSTITUIR POR: GET /vendas/:id/cobrancas/:cid */
export async function statusCobrancaVenda(chargeId: string): Promise<PixChargeStatus> {
  await delay(400)
  void chargeId
  return 'pending'
}

/* -------------------------------------------------------------------------- */
/* Documentos fiscais — NR-042, RF-004, RF-045, RF-054                        */
/* -------------------------------------------------------------------------- */

/**
 * So NFC-e sai por aqui, ao lado do web.
 *
 * O tipo mantem `'nfse'` porque a FICHA (`NotaEmitida`, a lista de historico)
 * precisa poder representar as duas — mas nenhum botao desta tela pede NFS-e:
 * ela e documento MUNICIPAL, com outro endpoint e outra regra por cidade, e o
 * emissor que a loja tem (Focus NFe, DEC-004) so faz NFC-e. Oferecer o botao
 * seria prometer um documento que nao sai, e a descoberta viria com o cliente
 * esperando no balcao.
 */
export type TipoNotaFiscal = 'nfce' | 'nfse'
export type EstadoEmissao = 'ocioso' | 'processando' | 'emitida' | 'erro'

export type NotaEmitida = {
  tipo: TipoNotaFiscal
  numero: string
  chave: string
  /** Link do DANFE/PDF devolvido pelo provedor. Vazio em contingencia. */
  url: string
}

/**
 * Certificado digital da empresa — RF-004.
 *
 * Era `return 'ausente'` fixo: a tela SEMPRE mandava cadastrar certificado,
 * mesmo com um valido no banco, e o botao de emitir nunca aparecia no
 * celular. Agora pergunta ao servidor, como o web.
 */
export type SituacaoCertificado = 'ausente' | 'valido' | 'expirado'

export async function situacaoCertificado(): Promise<SituacaoCertificado> {
  const r = await chamarApi<{ hasCertificate: boolean; certificateExpiresAt: string | null }>(
    '/empresa/credenciais-fiscais',
  )

  /* Sem conexao ou 4xx: tratar como ausente leva o lojista a tentar cadastrar
     de novo um certificado que ja existe, o que e chato mas seguro. Deixar
     emitir tambem nao serve — a emissao falharia adiante do mesmo jeito. */
  if (!r.ok || r.dados.hasCertificate !== true) return 'ausente'

  /*
   * Comparacao em AAAA-MM-DD, e nao com `Date`: os dois lados sao data pura, e
   * converter para instante traria o fuso de volta ao problema — um
   * certificado que vence hoje viraria "expirado" as 21h no Brasil.
   */
  const hoje = new Date()
  const dois = (n: number) => String(n).padStart(2, '0')
  const hojeIso = `${hoje.getFullYear()}-${dois(hoje.getMonth() + 1)}-${dois(hoje.getDate())}`

  return (r.dados.certificateExpiresAt ?? '') < hojeIso ? 'expirado' : 'valido'
}

/**
 * Pede a nota da venda — RF-045.
 *
 * O servidor ENFILEIRA e responde 202: a venda nao espera a SEFAZ (RNF-004).
 * O retorno de sucesso e "entrou na fila", nao "emitida" — dizer emitida aqui
 * afirmaria um documento que ainda nao existe. A recusa por classificacao
 * (RF-046) chega com o NOME dos produtos que faltam, e a tela mostra a
 * mensagem inteira: e ela que manda o lojista ao lugar certo.
 */
export async function pedirNota(
  vendaId: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const r = await chamarApi(`/vendas/${vendaId}/nota`, { method: 'POST' })

  return r.ok ? { ok: true } : { ok: false, erro: r.message }
}

export type EstadoDaNota =
  | { status: 'pending' }
  | { status: 'authorized'; accessKey: string; number: number; danfeUrl: string }
  | { status: 'contingency'; accessKey: string; number: number; reason: string }
  | { status: 'rejected'; rejection: { code: string; message: string } }

/** O estado fiscal da venda — RF-054. `null` quando a consulta falha. */
export async function estadoDaNota(vendaId: string): Promise<EstadoDaNota | null> {
  const r = await chamarApi<EstadoDaNota>(`/vendas/${vendaId}/nota`)
  return r.ok ? r.dados : null
}

/**
 * Pede ao servidor que confira as notas em contingencia — RF-053.
 *
 * Silenciosa de proposito: e uma atualizacao de fundo, e falhar nela nao muda
 * nada do que o lojista veio fazer. O estado de cada nota continua vindo de
 * `estadoDaNota`.
 */
export async function reconciliarContingencia(): Promise<void> {
  await chamarApi('/vendas/notas/reconciliar', { method: 'POST' }).catch(() => undefined)
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
 * Dados de exemplo, ainda em uso — mas so pelo assistente.
 *
 * A tela de vendas passou a usar `listarHistoricoDeVendas`, real, logo abaixo.
 * Esta funcao continua aqui porque `assistente-api.ts` a consulta para
 * responder "quanto vendi hoje" e afins — e o assistente esta fora do escopo
 * atual (aguarda a DEC-007, modelo de LLM). Trocar a fonte dele agora
 * misturaria dois trabalhos independentes.
 */
export function listarVendas(): VendaHistorico[] {
  return [
    {
      id: 'ven-1',
      numero: '1842',
      data: '2026-08-24T14:32:00',
      clienteNome: 'Joana Ribeiro',
      itens: [
        { descricao: 'Cafe torrado e moido 500g', quantidade: 2, precoUnitario: 21.9 },
        { descricao: 'Filtro de papel n103', quantidade: 1, precoUnitario: 8.9 },
        { descricao: 'Acucar mascavo 1kg', quantidade: 3, precoUnitario: 12.9 },
      ],
      subtotal: 91.4,
      desconto: 4.5,
      total: 86.9,
      pagamentos: [{ forma: 'pix', valor: 86.9 }],
      valorLiquido: 86.04,
      imposto: 3.12,
      nota: { tipo: 'nfce', numero: '4187' },
      status: 'concluida',
    },
    {
      id: 'ven-2',
      numero: '1841',
      data: '2026-08-24T13:58:00',
      clienteNome: 'Venda sem cliente',
      itens: [{ descricao: 'Azeite extra virgem 500ml', quantidade: 1, precoUnitario: 39.9 }],
      subtotal: 39.9,
      desconto: 0,
      total: 39.9,
      pagamentos: [{ forma: 'credito', valor: 39.9 }],
      valorLiquido: 38.51,
      imposto: 1.44,
      nota: { tipo: 'nfce', numero: '4186' },
      status: 'concluida',
    },
    {
      id: 'ven-3',
      numero: '1840',
      data: '2026-08-24T11:20:00',
      clienteNome: 'Marcos Dias',
      itens: [
        { descricao: 'Leite integral 1L', quantidade: 12, precoUnitario: 5.99 },
        { descricao: 'Biscoito integral 200g', quantidade: 6, precoUnitario: 7.5 },
      ],
      subtotal: 116.88,
      desconto: 0,
      total: 116.88,
      pagamentos: [{ forma: 'dinheiro', valor: 116.88 }],
      valorLiquido: 116.88,
      imposto: 4.21,
      nota: { tipo: 'nfce', numero: '4185' },
      status: 'concluida',
    },
    {
      id: 'ven-4',
      numero: '1839',
      data: '2026-08-23T17:05:00',
      clienteNome: 'Padaria Sol LTDA',
      itens: [{ descricao: 'Cafe torrado e moido 500g', quantidade: 8, precoUnitario: 19.5 }],
      subtotal: 156.0,
      desconto: 0,
      total: 156.0,
      pagamentos: [{ forma: 'debito', valor: 156.0 }],
      valorLiquido: 152.9,
      imposto: 5.62,
      nota: { tipo: 'nfce', numero: '4181' },
      status: 'concluida',
    },
    {
      id: 'ven-5',
      numero: '1838',
      data: '2026-08-23T09:44:00',
      clienteNome: 'Restaurante Boa Mesa',
      itens: [{ descricao: 'Azeite extra virgem 500ml', quantidade: 2, precoUnitario: 39.2 }],
      subtotal: 78.4,
      desconto: 0,
      total: 78.4,
      pagamentos: [{ forma: 'carteira', valor: 78.4 }],
      valorLiquido: 0,
      imposto: 0,
      nota: null,
      status: 'estornada',
    },
  ]
}

/** A forma de pagamento como o servidor a chama, de volta ao vocabulario da tela. */
const FORMA_DA_API: Record<string, FormaPagamento> = {
  cash: 'dinheiro',
  pix: 'pix',
  debit: 'debito',
  credit: 'credito',
  wallet: 'carteira',
}

type VendaDaApi = {
  id: string
  number: number
  soldAt: string
  customerName: string | null
  status: 'open' | 'settled' | 'cancelled' | 'returned'
  grossAmountCents: number
  discountCents: number
  netAmountCents: number
  taxAmountCents: number
  items: { description: string; quantity: number; unitPriceCents: number }[]
  payments: { method: string; amountCents: number }[]
  invoiceNumber: number | null
  invoiceAccessKey: string | null
}

/**
 * O historico de vendas de VERDADE — RF-036, US-021.
 *
 * A tela mostrava cinco vendas de exemplo, sempre as mesmas, com faturamento e
 * ticket medio somados sobre elas — numeros que pareciam reais e nao eram.
 *
 * So a primeira pagina (as mais recentes): a tela de historico do celular nao
 * tem paginacao ainda, e trazer tudo de uma vez custaria caro numa loja com
 * meses de venda. Ampliar o filtro fica para quando a tela pedir.
 */
export async function listarHistoricoDeVendas(): Promise<
  { ok: true; vendas: VendaHistorico[] } | { ok: false; erro: string }
> {
  const r = await chamarApi<{ sales: VendaDaApi[] }>('/sales')

  if (!r.ok) return { ok: false, erro: r.message }

  return {
    ok: true,
    vendas: r.dados.sales.map((v) => ({
      id: v.id,
      numero: String(v.number),
      data: v.soldAt,
      /* Venda sem cliente identificado e caminho normal no balcao (RF-009) —
         o rotulo diz isso, em vez de deixar a linha sem contraparte. */
      clienteNome: v.customerName ?? 'Venda sem cliente',
      itens: v.items.map((i) => ({
        descricao: i.description,
        quantidade: i.quantity,
        precoUnitario: i.unitPriceCents / 100,
      })),
      subtotal: v.grossAmountCents / 100,
      desconto: v.discountCents / 100,
      total: (v.grossAmountCents - v.discountCents) / 100,
      pagamentos: v.payments.map((p) => ({
        forma: FORMA_DA_API[p.method] ?? 'dinheiro',
        valor: p.amountCents / 100,
      })),
      valorLiquido: v.netAmountCents / 100,
      imposto: v.taxAmountCents / 100,
      /* `nfse` nunca aparece aqui: o emissor da loja so faz NFC-e (DEC-004). */
      nota: v.invoiceNumber === null ? null : { tipo: 'nfce', numero: String(v.invoiceNumber) },
      status: v.status === 'returned' || v.status === 'cancelled' ? 'estornada' : 'concluida',
    })),
  }
}

/**
 * Estorno de venda — RF-036.
 *
 * AINDA NAO EXISTE no backend, nem no web: precisa ser uma unica transacao
 * cobrindo tres coisas — devolver o item ao estoque, estornar o titulo em
 * Contas a Receber e cancelar a nota fiscal (ou emitir a de devolucao). Se uma
 * falhar, nenhuma pode valer, senao a venda estornada com estoque nao
 * devolvido vira furo de inventario que ninguem consegue explicar depois.
 *
 * Por isso o botao na tela avisa em vez de fingir — ver `vendas.tsx`.
 */
export async function estornarVenda(
  id: string,
): Promise<{ ok: true; itensDevolvidos: number } | { ok: false; error: string }> {
  await delay(1200)

  const venda = listarVendas().find((v) => v.id === id)
  if (!venda) return { ok: false, error: 'Venda não encontrada.' }
  if (venda.status === 'estornada') {
    return { ok: false, error: 'Esta venda já foi estornada.' }
  }

  const itensDevolvidos = venda.itens.reduce((acc, i) => acc + i.quantidade, 0)
  return { ok: true, itensDevolvidos }
}

/* -------------------------------------------------------------------------- */
/* Fechamento da venda contra a api — NR-071, RF-036, RNF-043                 */
/* -------------------------------------------------------------------------- */

/**
 * O metodo como o contrato o chama.
 *
 * A tela usa portugues (`dinheiro`, `carteira`); o contrato usa o vocabulario
 * do glossario (`cash`, `wallet`). A traducao acontece AQUI, na borda, e nao
 * espalhada — senao cada tela inventa a sua e uma delas erra.
 */
const METODO: Record<FormaPagamento, 'cash' | 'pix' | 'debit' | 'credit' | 'wallet'> = {
  dinheiro: 'cash',
  pix: 'pix',
  debito: 'debit',
  credito: 'credit',
  carteira: 'wallet',
}

/**
 * A venda como o servidor a gravou — US-020.
 *
 * Todos os valores vem da RESPOSTA, nenhum e recalculado aqui. O imposto usa a
 * aliquota da empresa e a tarifa usa a tabela do cadastro; refazer essa conta
 * no celular daria dois numeros para a mesma venda, e o que o lojista veria
 * dependeria de qual tela ele abriu.
 */
export type VendaRegistrada = {
  readonly id: string
  readonly numero: number
  readonly brutoCentavos: number
  readonly custoCentavos: number
  readonly impostoCentavos: number
  readonly tarifaCentavos: number
  readonly liquidoCentavos: number
  readonly trocoCentavos: number
  /** `true` quando o servidor devolveu uma venda que JA existia — RNF-043. */
  readonly reenvio: boolean
}

/**
 * Margem sobre o bruto, em pontos — RF-042.
 *
 * Liquido menos custo, sobre o bruto. `null` quando nao houve bruto: dividir
 * por zero daria `Infinity`, e "margem: Infinity%" e pior que "—".
 */
export function margemEmPontos(v: VendaRegistrada): number | null {
  if (v.brutoCentavos === 0) return null
  return Math.round(((v.liquidoCentavos - v.custoCentavos) / v.brutoCentavos) * 100 * 10) / 10
}

export type ResultadoFecharVenda =
  | { readonly ok: true; readonly venda: VendaRegistrada }
  | { readonly ok: false; readonly erro: string }

/**
 * Fecha a venda — RF-036, RNF-043.
 *
 * ## Sobre `chaveDeIdempotencia`
 *
 * Ela e PARAMETRO, e nao gerada aqui dentro, e essa e a decisao que faz a
 * idempotencia funcionar. Se fosse gerada a cada chamada, o reenvio depois de
 * uma falha de rede criaria uma SEGUNDA venda — com segundo estoque baixado e
 * segundo recebivel — e o cabecalho existiria sem proteger nada, que e pior que
 * nao te-lo, porque parece protegido.
 *
 * Quem chama gera a chave uma vez, quando o operador confirma, e reusa em toda
 * tentativa daquele fechamento.
 *
 * O total daqui NAO e enviado: o servidor recalcula preco, imposto e taxa a
 * partir do cadastro. O que a tela mostrou e referencia para o operador, nao
 * fonte da verdade — se divergir, quem esta certo e o servidor.
 */
export async function fecharVenda(
  itens: ItemCarrinho[],
  pagamentos: Pagamento[],
  chaveDeIdempotencia: string,
  opcoes: { clienteId?: string; descontoCentavos?: number } = {},
): Promise<ResultadoFecharVenda> {
  const r = await chamarApi<{
    sale: {
      id: string
      number: number
      grossAmountCents: number
      costAmountCents: number
      taxAmountCents: number
      cardFeeAmountCents: number
      netAmountCents: number
      changeCents: number
    }
    replayed: boolean
  }>('/sales', {
    method: 'POST',
    idempotencyKey: chaveDeIdempotencia,
    body: {
      ...(opcoes.clienteId === undefined ? {} : { customerId: opcoes.clienteId }),
      items: itens.map((i) => ({
        productId: i.produtoId,
        quantity: i.quantidade,
        /* Centavos inteiros na borda — RNF-044. */
        unitPriceCents: Math.round(i.precoUnitario * 100),
      })),
      payments: pagamentos.map((p) => ({
        method: METODO[p.forma],
        amountCents: Math.round(p.valor * 100),
      })),
      ...(opcoes.descontoCentavos === undefined ? {} : { discountCents: opcoes.descontoCentavos }),
    },
  })

  if (!r.ok) return { ok: false, erro: r.message }

  return {
    ok: true,
    venda: {
      id: r.dados.sale.id,
      numero: r.dados.sale.number,
      brutoCentavos: r.dados.sale.grossAmountCents,
      custoCentavos: r.dados.sale.costAmountCents,
      impostoCentavos: r.dados.sale.taxAmountCents,
      tarifaCentavos: r.dados.sale.cardFeeAmountCents,
      liquidoCentavos: r.dados.sale.netAmountCents,
      trocoCentavos: r.dados.sale.changeCents,
      reenvio: r.dados.replayed,
    },
  }
}

/**
 * O que ainda falta pagar — US-019.
 *
 * Devolve em centavos e pode ser NEGATIVO: pagaram a mais. So `dinheiro` vira
 * troco (RF-035); a mais no cartao ou no pix e erro de digitacao, e a tela
 * precisa distinguir os dois.
 */
export function faltaPagarCentavos(totalCentavos: number, pagamentos: Pagamento[]): number {
  const pago = pagamentos.reduce((soma, p) => soma + Math.round(p.valor * 100), 0)
  return totalCentavos - pago
}

/**
 * Uma chave por fechamento.
 *
 * `crypto.randomUUID` existe no Hermes do SDK 57. O prefixo nao e enfeite: no
 * log do servidor, uma chave que se identifica como vinda do PDV do celular
 * poupa a pergunta "de onde veio isto" quando alguem investigar um reenvio.
 */
export function novaChaveDeVenda(): string {
  return `pdv-${crypto.randomUUID()}`
}
