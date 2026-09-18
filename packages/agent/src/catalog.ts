import {
  catalogInputSchema,
  checkCustomerWalletInputSchema,
  createCustomerInputSchema,
  createSaleInputSchema,
  dreInputSchema,
  revenueByMonthInputSchema,
  saleHistoryInputSchema,
  sendChargeInputSchema,
  type CatalogInput,
  type CheckCustomerWalletInput,
  type CheckStockByQueryInput,
  type CheckStockInput,
  checkStockByQueryInputSchema,
  listPayablesInputSchema,
  type CreateCustomerInput,
  type CreateSaleInput,
  type DreInput,
  type DreOutput,
  type RevenueByMonthInput,
  type RevenueByMonthOutput,
  type SaleHistoryInput,
  type SaleHistoryOutput,
  type SendChargeInput,
  type StockViewOutput,
  type CustomerOutput,
  type ProductOutput,
} from '@na-regua/contracts'
import type {
  CheckCustomerWalletByQueryResult,
  CheckStockByQueryResult,
  ExecutionContext,
  RegisterCustomerResult,
  RegisterSaleResult,
  PayablesAgrupadas,
  ReceivablesAgrupadas,
  SendCustomerChargeResult,
} from '@na-regua/core'
import { z } from 'zod'
import { defineTool } from './define-tool.js'
import { formatarCentavos, formatarResumoDre } from './format.js'
import type { AgentTool } from './types.js'

const emptyInputSchema = z.object({}).strict()

/** RF-149 — recusa de certificado A1 / emitente; nada e guardado. */
export const TEXTO_RECUSA_CERTIFICADO =
  'Nao envio certificado, senha de A1 nem cadastro de emitente por esta conversa. Nada foi guardado. Faca isso no aplicativo, em dados fiscais.'

/** RF-150 — recusa de OFX / Open Finance / conciliacao; nada e importado. */
export const TEXTO_RECUSA_BANCO =
  'Nao importo extrato OFX/CSV, Open Finance nem conciliacao por esta conversa. Nada foi importado. Faca isso no aplicativo.'

/** RF-151 — recusa de emitir/cancelar nota avulsa; nota segue a venda. */
export const TEXTO_RECUSA_NOTA =
  'Nao emito nem cancelo nota por comando avulso. A NFC-e segue a venda (ou o cancelamento da venda) no aplicativo. Nada foi emitido nem cancelado.'

export type AgentUseCases = {
  readonly listSales: (ctx: ExecutionContext, input: SaleHistoryInput) => Promise<SaleHistoryOutput>
  readonly listReceivables: (ctx: ExecutionContext) => Promise<ReceivablesAgrupadas>
  /**
   * Consulta canônica de estoque. A tool que resolve texto entra na história
   * de estoque; este catálogo só define a costura com o núcleo.
   */
  readonly checkStock: (ctx: ExecutionContext, input: CheckStockInput) => Promise<StockViewOutput>
  /** Busca textual seguida de `checkStock` quando ha candidato unico — NR-115. */
  readonly checkStockByQuery: (
    ctx: ExecutionContext,
    input: CheckStockByQueryInput,
  ) => Promise<CheckStockByQueryResult>
  /** Resolucao limitada de cliente seguida de leitura de saldo — NR-115. */
  readonly checkCustomerWalletByQuery: (
    ctx: ExecutionContext,
    input: CheckCustomerWalletInput,
  ) => Promise<CheckCustomerWalletByQueryResult>
  /** Visão de vencimentos calculada pelo núcleo no instante de `ctx.now`. */
  readonly listPayables: (ctx: ExecutionContext) => Promise<PayablesAgrupadas>
  readonly registerCustomer: (
    ctx: ExecutionContext,
    input: CreateCustomerInput,
  ) => Promise<RegisterCustomerResult>
  readonly registerSale: (
    ctx: ExecutionContext,
    input: CreateSaleInput,
  ) => Promise<RegisterSaleResult>
  readonly searchProducts: (
    ctx: ExecutionContext,
    input: CatalogInput,
  ) => Promise<readonly ProductOutput[]>
  readonly revenueByMonth: (
    ctx: ExecutionContext,
    input: RevenueByMonthInput,
  ) => Promise<RevenueByMonthOutput>
  readonly buildDre: (ctx: ExecutionContext, input: DreInput) => Promise<DreOutput>
  readonly sendCustomerCharge: (
    ctx: ExecutionContext,
    input: SendChargeInput,
  ) => Promise<SendCustomerChargeResult>
}

export function createToolCatalog(casos: AgentUseCases): readonly AgentTool[] {
  return [
    defineTool({
      id: 'list_sales',
      description:
        'Consulta vendas de um periodo: total, quantidade e ticket medio. Use para perguntas como "quanto vendi hoje?".',
      inputSchema: saleHistoryInputSchema,
      mutatesValue: false,
      execute: (input, ctx) => casos.listSales(ctx, input),
      formatProposal: () => 'Consultar vendas',
      formatReply: (out) => {
        const s = out.summary
        const n = s.salesCount
        const periodo =
          n === 0 ? 'Nenhuma venda nesse periodo.' : `${n} venda${n === 1 ? '' : 's'}.`
        const ticket =
          s.averageTicketCents === null
            ? ''
            : ` Ticket medio ${formatarCentavos(s.averageTicketCents)}.`
        return `${periodo} Bruto ${formatarCentavos(s.grossCents)}. Liquido ${formatarCentavos(s.netAfterFeesCents)}.${ticket}`
      },
    }),
    defineTool({
      id: 'list_payables',
      description:
        'Lista contas a pagar por vencimento: vencidas, hoje, semana e mes. Use para "o que vence?" ou "quanto tenho a pagar?".',
      inputSchema: listPayablesInputSchema,
      mutatesValue: false,
      execute: (_input, ctx) => casos.listPayables(ctx),
      formatProposal: () => 'Consultar contas a pagar',
      formatReply: (out) => formatarRespostaPayables(out),
    }),
    defineTool({
      id: 'list_receivables',
      description:
        'Lista quem esta devendo, com valor e vencimento. Use para "quem esta me devendo?" ou inadimplentes.',
      inputSchema: emptyInputSchema,
      mutatesValue: false,
      execute: (_input, ctx) => casos.listReceivables(ctx),
      formatProposal: () => 'Consultar contas a receber',
      formatReply: (out) => {
        if (out.totalCents === 0) return 'Ninguem esta devendo no momento.'
        const linhas = out.grupos
          .flatMap((g) => g.receivables)
          .slice(0, 8)
          .map((r) => {
            const nome = r.customerName ?? 'cliente nao identificado'
            const emAberto = r.amountCents - r.settledAmountCents
            return `- ${nome}: ${formatarCentavos(emAberto)} (vence ${r.dueDate})`
          })
        const extra =
          out.grupos.reduce((n, g) => n + g.receivables.length, 0) > 8 ? '\n(e outros)' : ''
        return `Em aberto ${formatarCentavos(out.totalCents)}.\n${linhas.join('\n')}${extra}`
      },
    }),
    defineTool({
      id: 'check_stock',
      description:
        'Consulta saldo, preco e localizacao de um produto pelo nome. Use para "quanto tem de [produto]?".',
      inputSchema: checkStockByQueryInputSchema,
      mutatesValue: false,
      execute: (input, ctx) => casos.checkStockByQuery(ctx, input),
      formatProposal: (input) => `Consultar estoque de "${input.query}"`,
      formatReply: (out) => formatarRespostaEstoque(out),
    }),
    defineTool({
      id: 'check_customer_wallet',
      description:
        'Consulta o saldo em carteira (fiado) de um cliente pelo nome. Use para "quanto o [cliente] deve?".',
      inputSchema: checkCustomerWalletInputSchema,
      mutatesValue: false,
      execute: (input, ctx) => casos.checkCustomerWalletByQuery(ctx, input),
      formatProposal: (input) => `Consultar fiado de "${input.query}"`,
      formatReply: (out) => formatarRespostaFiado(out),
    }),
    defineTool({
      id: 'search_products',
      description:
        'Busca produtos do catalogo por nome, codigo interno ou barras. Use quando o produto da mensagem for ambiguo.',
      inputSchema: catalogInputSchema,
      mutatesValue: false,
      execute: (input, ctx) => casos.searchProducts(ctx, input),
      formatProposal: (input) => `Buscar produto "${input.q ?? ''}"`,
      formatReply: (produtos) => {
        if (produtos.length === 0) return 'Nenhum produto encontrado com esse nome.'
        if (produtos.length === 1) {
          const p = produtos[0]!
          return `${p.description} (${p.id}) — ${formatarCentavos(p.salePriceCents)}.`
        }
        const opcoes = produtos
          .slice(0, 5)
          .map((p) => `- ${p.description} (${p.id}) ${formatarCentavos(p.salePriceCents)}`)
        return `Encontrei mais de um. Qual deles?\n${opcoes.join('\n')}`
      },
    }),
    defineTool({
      id: 'period_summary',
      description:
        'Resumo do periodo com faturamento, custo, despesas e resultado (DRE). Use para "resumo do mes".',
      inputSchema: dreInputSchema,
      mutatesValue: false,
      execute: (input, ctx) => casos.buildDre(ctx, input),
      formatProposal: (input) => `Resumo de ${input.from} a ${input.to}`,
      formatReply: (out) => formatarResumoDre(out),
    }),
    defineTool({
      id: 'revenue_by_month',
      description:
        'Faturamento liquido por mes no periodo. Nao e o DRE — para custo, despesas e resultado use period_summary.',
      inputSchema: revenueByMonthInputSchema,
      mutatesValue: false,
      execute: (input, ctx) => casos.revenueByMonth(ctx, input),
      formatProposal: (input) => `Faturamento de ${input.from} a ${input.to}`,
      formatReply: (out) =>
        `Faturamento liquido ${formatarCentavos(out.totalNetCents)} de ${out.from} a ${out.to}.`,
    }),
    defineTool({
      id: 'create_customer',
      description:
        'Cadastra um cliente. Exige confirmacao. Use quando o lojista pedir para cadastrar alguem.',
      inputSchema: createCustomerInputSchema,
      mutatesValue: true,
      execute: (input, ctx) => casos.registerCustomer(ctx, input),
      formatProposal: (input) => {
        const tel = input.phone === undefined ? '' : `, telefone ${input.phone}`
        return `Cadastrar cliente ${input.name}${tel}`
      },
      formatReply: (out) => {
        if (out.status === 'duplicate_found') {
          const nomes = out.candidates.map((c) => c.name).join(', ')
          return `Ja existe cadastro parecido (${nomes}). Confirme se e outra pessoa ou reutilize o existente.`
        }
        return `Cliente ${out.customer.name} cadastrado.`
      },
    }),
    defineTool({
      id: 'create_sale',
      description:
        'Registra uma venda com os mesmos calculos do aplicativo. Exige confirmacao. Nao some valores — o sistema calcula.',
      inputSchema: createSaleInputSchema,
      mutatesValue: true,
      execute: (input, ctx) => casos.registerSale(ctx, input),
      formatProposal: (input) => {
        const cliente = input.customerId === undefined ? '' : ` para cliente ${input.customerId}`
        const itens = input.items
          .map((i) => `${i.quantity}x ${i.productId} a ${formatarCentavos(i.unitPriceCents)}`)
          .join(', ')
        const pagamentos = input.payments
          .map((p) => `${p.method} ${formatarCentavos(p.amountCents)}`)
          .join(', ')
        const desconto =
          input.discountCents === undefined || input.discountCents === 0
            ? ''
            : `. Desconto ${formatarCentavos(input.discountCents)}`
        return `Registrar venda${cliente}: ${itens}. Pagamento: ${pagamentos}${desconto}`
      },
      formatReply: (out) =>
        `Venda #${out.sale.number} registrada — ${formatarCentavos(out.sale.netAmountCents)}.`,
    }),
    defineTool({
      id: 'send_charge',
      description:
        'Envia cobranca por mensagem a um cliente com divida em aberto. Exige confirmacao. Sem divida, informa e nao envia.',
      inputSchema: sendChargeInputSchema,
      mutatesValue: true,
      execute: (input, ctx) => casos.sendCustomerCharge(ctx, input),
      formatProposal: (input) => {
        const alvo =
          input.customerId !== undefined
            ? `cliente ${input.customerId}`
            : `telefone ${input.phone ?? ''}`
        return `Enviar cobranca para ${alvo}`
      },
      formatReply: (out) => {
        if (out.status === 'nothing_to_charge') {
          return `${out.customerName} nao tem divida em aberto. Nada foi enviado.`
        }
        if (out.status === 'rejected') {
          return `Nao deu para enviar a cobranca para ${out.customerName}. ${out.message}`
        }
        return `Cobranca de ${formatarCentavos(out.amountCents)} enviada para ${out.customerName}.`
      },
    }),
    defineTool({
      id: 'refuse_certificate',
      description:
        'Recusa certificado A1, senha de certificado, arquivo PFX ou cadastro de emitente. Oriente o aplicativo. Nao peca arquivo nem senha.',
      inputSchema: emptyInputSchema,
      mutatesValue: false,
      execute: async () => ({}),
      formatProposal: () => 'Recusar certificado',
      formatReply: () => TEXTO_RECUSA_CERTIFICADO,
    }),
    defineTool({
      id: 'refuse_banking',
      description:
        'Recusa importacao de extrato OFX/CSV, Open Finance e conciliacao bancaria. Oriente o aplicativo. Nao peca o arquivo.',
      inputSchema: emptyInputSchema,
      mutatesValue: false,
      execute: async () => ({}),
      formatProposal: () => 'Recusar importacao bancaria',
      formatReply: () => TEXTO_RECUSA_BANCO,
    }),
    defineTool({
      id: 'refuse_invoice_command',
      description:
        'Recusa emitir ou cancelar nota/NFC-e por comando avulso. A nota segue a venda. Nao use create_sale so para emitir nota.',
      inputSchema: emptyInputSchema,
      mutatesValue: false,
      execute: async () => ({}),
      formatProposal: () => 'Recusar comando de nota',
      formatReply: () => TEXTO_RECUSA_NOTA,
    }),
  ]
}

export function textoDasCapacidades(tools: readonly AgentTool[]): string {
  const linhas = tools.map((t) => `- ${t.id}: ${t.description}`)
  return 'Nao entendi o pedido. Estas sao as capacidades disponiveis agora:\n' + linhas.join('\n')
}

const ROTULO_FAIXA_PAYABLES: Record<'overdue' | 'today' | 'week' | 'month', string> = {
  overdue: 'Vencidas',
  today: 'Hoje',
  week: 'Proximos 7 dias',
  month: 'Este mes',
}

function formatarRespostaPayables(out: PayablesAgrupadas): string {
  if (out.totalCents === 0) return 'Nao ha vencimentos no momento.'

  const linhas: string[] = []
  if (out.temVencidas) linhas.push('Atencao: ha contas vencidas.')

  for (const faixa of ['overdue', 'today', 'week', 'month'] as const) {
    const grupo = out.grupos.find((g) => g.faixa === faixa)!
    linhas.push(`${ROTULO_FAIXA_PAYABLES[faixa]}: ${formatarCentavos(grupo.totalCents)}.`)
  }

  const depois = out.grupos.find((g) => g.faixa === 'later')
  if (depois !== undefined && depois.totalCents > 0) {
    linhas.push(`Depois deste mes: ${formatarCentavos(depois.totalCents)}.`)
  }

  return linhas.join('\n')
}

function formatarRespostaEstoque(out: CheckStockByQueryResult): string {
  if (out.status === 'not_found') {
    return 'Nao encontrei esse produto. Se quiser, pode cadastrar por texto em outro fluxo.'
  }

  if (out.status === 'ambiguous') {
    const opcoes = out.alternatives.slice(0, 5).map((p) => `- ${p.description} (${p.id})`)
    return `Encontrei mais de um produto. Qual deles?\n${opcoes.join('\n')}`
  }

  const v = out.view
  const preco = formatarCentavos(v.salePriceCents)
  const local = v.location ?? 'indisponivel'

  if (v.stockQuantity === null) {
    return `${v.description}: sem controle de estoque. Preco ${preco}. Localizacao ${local}.`
  }

  return `${v.description}: ${v.stockQuantity} un. Preco ${preco}. Localizacao ${local}.`
}

function formatarAlternativaCliente(cliente: CustomerOutput): string {
  const partes = [`${cliente.name} (${cliente.id})`]
  if (cliente.phone !== null) partes.push(cliente.phone)
  if (cliente.document !== null) partes.push(cliente.document)
  return `- ${partes.join(' ')}`
}

function formatarRespostaFiado(out: CheckCustomerWalletByQueryResult): string {
  if (out.status === 'not_found') {
    return 'Nao encontrei esse cliente.'
  }

  if (out.status === 'ambiguous') {
    const opcoes = out.alternatives.slice(0, 5).map(formatarAlternativaCliente)
    return `Encontrei mais de um cliente. Qual deles?\n${opcoes.join('\n')}`
  }

  if (out.walletBalanceCents === 0) {
    return `${out.customerName} nao tem saldo devedor.`
  }

  return `${out.customerName} deve ${formatarCentavos(out.walletBalanceCents)}.`
}
