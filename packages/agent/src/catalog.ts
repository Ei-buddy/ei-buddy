import type {
  AdjustStockInput,
  AppointmentOutput,
  CancelSaleInput,
  CatalogInput,
  CheckCustomerWalletInput,
  CheckStockByQueryInput,
  CheckStockInput,
  CreateAppointmentInput,
  CreateCustomerInput,
  CreatePayableInput,
  CreateProductInput,
  CreateReceivableInput,
  CreateSaleInput,
  CustomerOutput,
  CustomerRankingOutput,
  DreInput,
  DreOutput,
  InventoryMovementOutput,
  ListDayAppointmentsInput,
  PayableOutput,
  ProductOutput,
  ProductRankingOutput,
  RankingInput,
  ReceivableOutput,
  RevenueByMonthInput,
  RevenueByMonthOutput,
  SaleHistoryInput,
  SaleHistoryOutput,
  SendChargeInput,
  SettlePayableInput,
  SettleReceivableInput,
  SettlementOutput,
  StockViewOutput,
  UpdateCustomerInput,
  UpdateProductInput,
} from '@na-regua/contracts'
import type {
  CheckCustomerWalletByQueryResult,
  CheckStockByQueryResult,
  DayAgenda,
  ExecutionContext,
  PayablesAgrupadas,
  ReceivablesAgrupadas,
  RegisterCustomerResult,
  RegisterSaleResult,
  SendCustomerChargeResult,
} from '@na-regua/core'

/** RF-149 — recusa de certificado A1 / emitente; nada e guardado. */
export const TEXTO_RECUSA_CERTIFICADO =
  'Nao envio certificado, senha de A1 nem cadastro de emitente por esta conversa. Nada foi guardado. Faca isso no aplicativo, em dados fiscais.'

/** RF-150 — recusa de OFX / Open Finance / conciliacao; nada e importado. */
export const TEXTO_RECUSA_BANCO =
  'Nao importo extrato OFX/CSV, Open Finance nem conciliacao por esta conversa. Nada foi importado. Faca isso no aplicativo.'

/** RF-151 — recusa de emitir/cancelar nota avulsa; nota segue a venda. */
export const TEXTO_RECUSA_NOTA =
  'Nao emito nem cancelo nota por comando avulso. A NFC-e segue a venda (ou o cancelamento da venda) no aplicativo. Nada foi emitido nem cancelado.'

/**
 * Foto e outras midias nao sao tratadas nesta fatia (spec 013): a mesma frase
 * para qualquer canal, sem chamar o modelo.
 */
export const FRASE_PEDIDO_DE_TEXTO = 'Envie sua pergunta ou pedido por texto para eu poder ajudar.'

/** Conta bancaria / contato da ficha — sem remocao nesta fatia. */
export const TEXTO_RECUSA_CONTA_CONTATO =
  'Nao apago conta bancaria nem contato por esta conversa. Nada foi removido. Faca isso no aplicativo.'

/**
 * Os casos de uso de `core` que o Buddy alcanca — principio I.
 *
 * `apps/api/src/composition.ts` injeta os mesmos casos de uso da tela; as
 * tools so validam com `contracts`, montam o contexto e chamam daqui.
 */
export type AgentUseCases = {
  readonly listSales: (ctx: ExecutionContext, input: SaleHistoryInput) => Promise<SaleHistoryOutput>
  readonly listReceivables: (ctx: ExecutionContext) => Promise<ReceivablesAgrupadas>
  /** Saldo, preco e localizacao de um produto ja resolvido. */
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
  /** Busca de cliente com limite, para "existe esse cliente?" antes de propor. */
  readonly searchCustomers: (
    ctx: ExecutionContext,
    input: { readonly termo?: string; readonly limite?: number },
  ) => Promise<readonly CustomerOutput[]>
  readonly searchProducts: (
    ctx: ExecutionContext,
    input: CatalogInput,
  ) => Promise<readonly ProductOutput[]>
  readonly registerCustomer: (
    ctx: ExecutionContext,
    input: CreateCustomerInput,
  ) => Promise<RegisterCustomerResult>
  readonly registerSale: (
    ctx: ExecutionContext,
    input: CreateSaleInput,
  ) => Promise<RegisterSaleResult>
  readonly revenueByMonth: (
    ctx: ExecutionContext,
    input: RevenueByMonthInput,
  ) => Promise<RevenueByMonthOutput>
  readonly buildDre: (ctx: ExecutionContext, input: DreInput) => Promise<DreOutput>
  readonly sendCustomerCharge: (
    ctx: ExecutionContext,
    input: SendChargeInput,
  ) => Promise<SendCustomerChargeResult>
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
  /** RF-147 — cancelamento total pelo caso de uso da tela. */
  readonly cancelSale: (ctx: ExecutionContext, input: CancelSaleInput) => Promise<void>
  /** US-045 pela conversa: a agenda de um dia, com "livre" explicito. */
  readonly listDayAppointments: (
    ctx: ExecutionContext,
    input: ListDayAppointmentsInput,
  ) => Promise<DayAgenda>
  readonly rankCustomers: (
    ctx: ExecutionContext,
    input: RankingInput,
  ) => Promise<CustomerRankingOutput>
  readonly rankProducts: (
    ctx: ExecutionContext,
    input: RankingInput,
  ) => Promise<ProductRankingOutput>
  /** Edicao de cliente — so os campos pedidos. */
  readonly updateCustomer: (
    ctx: ExecutionContext,
    customerId: string,
    input: UpdateCustomerInput,
  ) => Promise<CustomerOutput>
  /** Edicao de produto — so os campos pedidos. */
  readonly updateProduct: (
    ctx: ExecutionContext,
    productId: string,
    input: UpdateProductInput,
  ) => Promise<ProductOutput>
  /** Soft-delete de cliente (`deleted_at`). */
  readonly deleteCustomer: (ctx: ExecutionContext, customerId: string) => Promise<void>
  /** Soft-delete de produto (`deleted_at`). */
  readonly deleteProduct: (ctx: ExecutionContext, productId: string) => Promise<void>
  /** Nome ou id → id de produto. Ausente = usa o ref cru. */
  readonly resolveProductId?: (ctx: ExecutionContext, ref: string) => Promise<string>
  /** Nome ou id → id de cliente. Ausente = usa o ref cru. */
  readonly resolveCustomerId?: (ctx: ExecutionContext, ref: string) => Promise<string>
}
