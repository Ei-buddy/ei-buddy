import {
  catalogInputSchema,
  checkCustomerWalletInputSchema,
  createCustomerInputSchema,
  createPayableInputSchema,
  createProductInputSchema,
  createReceivableInputSchema,
  createSaleInputSchema,
  dreInputSchema,
  adjustStockInputSchema,
  createAppointmentInputSchema,
  listDayAppointmentsInputSchema,
  settlePayableInputSchema,
  settleReceivableInputSchema,
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
  type CreatePayableInput,
  type CreateProductInput,
  type CreateReceivableInput,
  type CreateSaleInput,
  type DreInput,
  type DreOutput,
  type AdjustStockInput,
  type AppointmentOutput,
  type CreateAppointmentInput,
  type ListDayAppointmentsInput,
  type InventoryMovementOutput,
  type PayableOutput,
  type ReceivableOutput,
  type SettlePayableInput,
  type SettleReceivableInput,
  type SettlementOutput,
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
  DayAgenda,
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
  readonly findProductByBarcode: (
    ctx: ExecutionContext,
    barcode: string,
  ) => Promise<ProductOutput | undefined>
  /** RF-140 — o MESMO caso de uso do aplicativo, incluindo a recusa de EAN repetido. */
  readonly registerProduct: (
    ctx: ExecutionContext,
    input: CreateProductInput,
  ) => Promise<ProductOutput>
  /** RF-141 — devolve N titulos quando ha recorrencia, como no aplicativo. */
  readonly createPayable: (
    ctx: ExecutionContext,
    input: CreatePayableInput,
  ) => Promise<readonly PayableOutput[]>
  /** RF-142 — recebivel que nao vem de venda. */
  readonly createReceivable: (
    ctx: ExecutionContext,
    input: CreateReceivableInput,
  ) => Promise<ReceivableOutput>
  /** RF-143 — baixa de conta a pagar, total ou parcial. */
  readonly settlePayable: (
    ctx: ExecutionContext,
    input: SettlePayableInput,
  ) => Promise<SettlementOutput>
  /** RF-144 — baixa de recebivel, total ou parcial. */
  readonly settleReceivable: (
    ctx: ExecutionContext,
    input: SettleReceivableInput,
  ) => Promise<SettlementOutput>
  /** RF-145 — ajuste de saldo com motivo, virando movimento na trilha. */
  readonly adjustStock: (
    ctx: ExecutionContext,
    input: AdjustStockInput,
  ) => Promise<InventoryMovementOutput>
  /** RF-148 — compromisso com lembrete, pelo caso de uso da agenda. */
  readonly createAppointment: (
    ctx: ExecutionContext,
    input: CreateAppointmentInput,
  ) => Promise<AppointmentOutput>
  /** US-045 pela conversa: a agenda de um dia, com "livre" explicito. */
  readonly listDayAppointments: (
    ctx: ExecutionContext,
    input: ListDayAppointmentsInput,
  ) => Promise<DayAgenda>
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
      id: 'create_product',
      description:
        'Cadastra um produto com descricao, custo e preco de venda. Exige confirmacao. Use para "cadastra [produto] custo X vende a Y".',
      inputSchema: createProductInputSchema,
      mutatesValue: true,
      execute: (input, ctx) => casos.registerProduct(ctx, input),
      formatProposal: (input) => {
        const codigo = input.barcode === undefined ? '' : ` (codigo ${input.barcode})`
        return (
          `Cadastrar produto ${input.description}${codigo}: ` +
          `custo ${formatarCentavos(input.costPriceCents)}, ` +
          `venda ${formatarCentavos(input.salePriceCents)}`
        )
      },
      formatReply: (out) =>
        `Produto ${out.description} cadastrado (${out.internalCode}) — ${formatarCentavos(out.salePriceCents)}.`,
    }),
    defineTool({
      id: 'create_payable',
      description:
        'Lanca uma conta a pagar com fornecedor, valor e vencimento. Exige confirmacao. Nao invente valor nem vencimento: pergunte o que faltar.',
      inputSchema: createPayableInputSchema,
      mutatesValue: true,
      execute: (input, ctx) => casos.createPayable(ctx, input),
      formatProposal: (input) => {
        const repete = input.recurrence === undefined ? '' : ', repetindo'
        return (
          `Lancar conta a pagar de ${input.supplier}: ${input.description}, ` +
          `${formatarCentavos(input.amountCents)}, vence ${input.dueDate}${repete}`
        )
      },
      formatReply: (out) => {
        const primeira = out[0]
        if (primeira === undefined) return 'Nenhuma conta foi lancada.'
        // Recorrencia vira N titulos de verdade (ver `createPayable`), entao a
        // resposta precisa dizer quantos — senao o lojista confirma "aluguel" e
        // nao sabe que nasceram doze.
        if (out.length > 1) {
          return `${out.length} contas lancadas para ${primeira.supplier}, de ${formatarCentavos(primeira.amountCents)} cada. A primeira vence ${primeira.dueDate}.`
        }
        return `Conta de ${primeira.supplier} lancada: ${formatarCentavos(primeira.amountCents)}, vence ${primeira.dueDate}.`
      },
    }),
    defineTool({
      id: 'create_receivable',
      description:
        'Lanca um valor a receber que NAO vem de venda (aluguel, servico avulso). Exige confirmacao. Para venda, use create_sale.',
      inputSchema: createReceivableInputSchema,
      mutatesValue: true,
      execute: (input, ctx) => casos.createReceivable(ctx, input),
      formatProposal: (input) => {
        const cliente = input.customerId === undefined ? '' : ` do cliente ${input.customerId}`
        return (
          `Lancar a receber${cliente}: ${input.description}, ` +
          `${formatarCentavos(input.amountCents)}, vence ${input.dueDate}`
        )
      },
      formatReply: (out) =>
        `A receber lancado: ${out.description}, ${formatarCentavos(out.amountCents)}, vence ${out.dueDate}.`,
    }),
    defineTool({
      id: 'settle_payable',
      description:
        'Da baixa numa conta a pagar, total ou parcial. Exige confirmacao. Precisa do id da conta — use list_payables antes se nao souber.',
      inputSchema: settlePayableInputSchema,
      mutatesValue: true,
      execute: (input, ctx) => casos.settlePayable(ctx, input),
      formatProposal: (input) =>
        `Baixar ${formatarCentavos(input.amountCents)} da conta ${input.payableId} em ${input.settledOn}, por ${input.bankAccount}`,
      formatReply: (out) => formatarBaixa(out, 'Conta'),
    }),
    defineTool({
      id: 'settle_receivable',
      description:
        'Da baixa num recebivel, total ou parcial. Exige confirmacao. Precisa do id do recebivel — use list_receivables antes se nao souber.',
      inputSchema: settleReceivableInputSchema,
      mutatesValue: true,
      execute: (input, ctx) => casos.settleReceivable(ctx, input),
      formatProposal: (input) =>
        `Registrar recebimento de ${formatarCentavos(input.amountCents)} do titulo ${input.receivableId} em ${input.settledOn}, por ${input.method}`,
      formatReply: (out) => formatarBaixa(out, 'Recebivel'),
    }),
    defineTool({
      id: 'adjust_stock',
      description:
        'Corrige o saldo de um produto para a quantidade contada, com motivo obrigatorio. Exige confirmacao. Informe quantas unidades EXISTEM, nao a diferenca.',
      inputSchema: adjustStockInputSchema,
      mutatesValue: true,
      execute: (input, ctx) => casos.adjustStock(ctx, input),
      formatProposal: (input) =>
        `Ajustar o estoque de ${input.productId} para ${input.countedQuantity} un. Motivo: ${input.reason}`,
      formatReply: (out) => {
        // `quantityDelta` e assinado; dizer so o saldo final esconderia um
        // ajuste grande digitado errado, que e o erro que este fluxo mais
        // convida — contagem no lugar de diferenca.
        const sinal = out.quantityDelta > 0 ? `+${out.quantityDelta}` : `${out.quantityDelta}`
        return `Estoque ajustado em ${sinal} un. Saldo agora: ${out.balanceAfter} un.`
      },
    }),
    defineTool({
      id: 'create_appointment',
      description:
        'Cria um compromisso na agenda, com lembrete opcional. Exige confirmacao. Nao invente data nem hora: se faltar, pergunte.',
      inputSchema: createAppointmentInputSchema,
      mutatesValue: true,
      execute: (input, ctx) => casos.createAppointment(ctx, input),
      formatProposal: (input) => {
        const onde = input.location === undefined ? '' : `, em ${input.location}`
        const lembrete =
          input.reminderMinutesBefore === undefined
            ? ''
            : `, lembrando ${input.reminderMinutesBefore} min antes`
        return `Marcar "${input.title}" para ${input.startsAt}${onde}${lembrete}`
      },
      formatReply: (out) => `Compromisso "${out.title}" marcado para ${out.startsAt}.`,
    }),
    defineTool({
      id: 'day_agenda',
      description:
        'Mostra os compromissos de um dia. Use para "o que tenho hoje?" ou "minha agenda de amanha".',
      inputSchema: listDayAppointmentsInputSchema,
      mutatesValue: false,
      execute: (input, ctx) => casos.listDayAppointments(ctx, input),
      formatProposal: (input) => `Consultar a agenda de ${input.day}`,
      formatReply: (out) => {
        // `isFree` existe como campo justamente para "nao ha nada" nao se
        // confundir com "nao consegui carregar" — RF-093.
        if (out.appointments.length === 0) return `Agenda livre em ${out.day}.`
        const linhas = out.appointments
          .slice(0, 10)
          .map((a) => `- ${a.startsAt}: ${a.title}${a.location === null ? '' : ` (${a.location})`}`)
        const extra = out.appointments.length > 10 ? '\n(e outros)' : ''
        return `Agenda de ${out.day}:\n${linhas.join('\n')}${extra}`
      },
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

/**
 * Texto da baixa — RF-143, RF-144.
 *
 * O core devolve a LINHA de baixa, nao o titulo, entao daqui nao da para dizer
 * "quitada" ou "resta X": um titulo tem varias baixas, e o saldo e a soma
 * delas. Dizer o que foi baixado e honesto; inventar o restante seria chutar.
 */
function formatarBaixa(out: SettlementOutput, rotulo: 'Conta' | 'Recebivel'): string {
  return `${rotulo} baixada em ${formatarCentavos(out.amountCents)}, com data de ${out.settledOn}.`
}
