import type {
  CancelServiceInvoiceRequest,
  InvoiceRejection,
  ServiceInvoiceCancellation,
  ServiceInvoiceRequest,
  ServiceInvoiceResult,
} from '@na-regua/contracts'
import type { CompanyId } from '../context.js'

/**
 * Portas da NFS-e da venda — DEC-031, NR-241.
 *
 * A NFS-e nacional e assincrona: o pedido vira "processando" e a autorizacao
 * chega depois, por consulta. Por isso ha uma fila com DOIS trabalhos — emitir
 * e consultar de novo — e uma guarda que lembra em que pe cada venda esta.
 */

/** Um item da venda, com o NBS do produto: e o NBS que faz dele um servico. */
export type ItemDaVendaParaNfse = {
  readonly description: string
  readonly quantity: number
  readonly unitPriceCents: number
  readonly nbsCode: string | null
}

export type VendaParaNfse = {
  readonly saleId: string
  /** Quando a venda aconteceu — o dia de competencia do ISS. */
  readonly soldAt: Date
  readonly grossAmountCents: number
  /** Desconto no total da venda, dividido entre mercadoria e servico. */
  readonly discountCents: number
  readonly items: readonly ItemDaVendaParaNfse[]
  readonly customer:
    { readonly document?: string; readonly name?: string; readonly email?: string } | undefined
}

export type EmpresaParaNfse = {
  readonly cnpj: string
  readonly municipalRegistration: string | null
  readonly city: string | null
  readonly state: string | null
  readonly cityIbgeCode: string | null
  readonly taxRegime: string
  readonly nationalServiceCode: string | null
  readonly issRatePercent: number | null
}

export type EstadoDaNfse = 'processing' | 'authorized' | 'rejected' | 'cancelled'

/** A NFS-e como a guarda lembra dela. */
export type NfseGuardada = {
  readonly status: EstadoDaNfse
  readonly amountCents: number
  readonly discountCents: number
  readonly description: string
  readonly number: string | null
  readonly accessKey: string | null
  readonly verificationCode: string | null
  readonly danfseUrl: string | null
  readonly publicUrl: string | null
  readonly rejection: InvoiceRejection | null
  readonly requestedAt: string
  readonly issuedAt: string | null
  readonly cancelledAt: string | null
  readonly lastCheckedAt: string | null
  readonly checks: number
}

export type ServiceInvoiceRepository = {
  saleForNfse(companyId: CompanyId, saleId: string): Promise<VendaParaNfse | undefined>
  companyForNfse(companyId: CompanyId): Promise<EmpresaParaNfse | undefined>
  /** Guarda o codigo IBGE achado pela cidade, para nao procurar de novo. */
  saveCityCode(companyId: CompanyId, cityIbgeCode: string): Promise<void>
  find(companyId: CompanyId, saleId: string): Promise<NfseGuardada | undefined>
  /**
   * Abre o pedido como "processando": cria a linha, ou devolve a rejeitada a
   * esse estado. `false` quando ja ha uma que nao foi rejeitada — dois cliques
   * ao mesmo tempo, e so um pode mandar a nota.
   */
  open(
    companyId: CompanyId,
    saleId: string,
    pedido: {
      readonly amountCents: number
      readonly discountCents: number
      readonly description: string
      readonly requestedAt: Date
    },
  ): Promise<boolean>
  /** Grava o que o provedor disse, e conta a consulta. */
  record(
    companyId: CompanyId,
    saleId: string,
    resultado: ServiceInvoiceResult,
    em: Date,
  ): Promise<void>
  markCancelled(companyId: CompanyId, saleId: string, reason: string, em: Date): Promise<void>
}

/** O emissor — implementado em `fiscal` (`criarEmissorNfsenFocus` e o falso). */
export type ServiceInvoiceIssuer = {
  issue(request: ServiceInvoiceRequest): Promise<ServiceInvoiceResult>
  consult(request: {
    readonly companyId: string
    readonly saleId: string
  }): Promise<ServiceInvoiceResult | undefined>
  cancel(request: CancelServiceInvoiceRequest): Promise<ServiceInvoiceCancellation>
}

export type ServiceInvoiceCheck = {
  readonly companyId: string
  readonly saleId: string
  /** Quantas consultas ja foram feitas por este pedido. */
  readonly checks: number
}

export type ServiceInvoiceQueue = {
  enqueueIssue(request: ServiceInvoiceRequest): Promise<void>
  enqueueCheck(check: ServiceInvoiceCheck, delayMs: number): Promise<void>
}

/** Codigo IBGE do municipio pelo nome e UF — a NFS-e pede, o cadastro nao tem. */
export type CityCodeLookup = {
  codigoIbge(uf: string, cidade: string): Promise<string | undefined>
}
