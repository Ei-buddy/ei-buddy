import {
  ErroDeIntegracao,
  type SaleServiceInvoiceOutput,
  type ServiceInvoiceRequest,
  type ServiceInvoiceResult,
  serviceInvoiceRequestSchema,
  type SimplesNacionalOption,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type {
  CityCodeLookup,
  ItemDaVendaParaNfse,
  NfseGuardada,
  ServiceInvoiceCheck,
  ServiceInvoiceIssuer,
  ServiceInvoiceQueue,
  ServiceInvoiceRepository,
  VendaParaNfse,
} from '../ports/service-invoice.js'

/**
 * NFS-e da venda — DEC-031, NR-241.
 *
 * Os servicos da venda (os itens cujo produto tem NBS) saem numa NFS-e
 * nacional; a mercadoria continua na NFC-e. A emissao e ASSINCRONA: pedir
 * grava "processando" e poe na fila; o worker envia e, enquanto o Ambiente
 * Nacional nao responde, consulta de novo com espera crescente.
 *
 * O que a loja precisa ter, e a mensagem que diz onde arrumar — validado aqui,
 * antes da fila, para o erro aparecer na hora e nao numa rejeicao minutos
 * depois.
 */

/** Quantas vezes o worker consulta uma nota que segue "processando". */
export const CONSULTAS_MAXIMAS = 12

/** Espera ate a consulta `n` (0, 1, 2...): 15 s dobrando, no maximo 15 min. */
export function esperaDaConsulta(n: number): number {
  return Math.min(15_000 * 2 ** n, 15 * 60_000)
}

/** A tela so pede uma consulta nova ao provedor depois deste intervalo. */
export const INTERVALO_DA_CONSULTA_NA_TELA_MS = 20_000

const FUSO_DA_COMPETENCIA = 'America/Sao_Paulo'

/** O regime do cadastro para a opcao do Simples que a NFS-e pede. */
export function opcaoDoSimples(regime: string): SimplesNacionalOption {
  if (regime === 'mei') return 'mei'
  if (regime === 'simples_nacional' || regime === 'simples') return 'me_epp'
  return 'not_optant'
}

/** O dia da venda no fuso de Brasilia (AAAA-MM-DD) — a competencia do ISS. */
export function diaDeCompetencia(em: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_DA_COMPETENCIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(em)
}

/** Item com NBS e servico — o resto e mercadoria, que vai na NFC-e. */
export const eServico = (i: { readonly nbsCode: string | null }): boolean => i.nbsCode !== null

/**
 * Valor, desconto, descricao e NBS da nota a partir dos servicos da venda.
 *
 * O desconto da venda e no TOTAL; a NFS-e leva a parte dele que cabe aos
 * servicos, na proporcao do valor. A DPS tem um NBS so: vai o do servico de
 * maior valor, que e o que mais pesa na nota.
 */
export function montarServico(venda: VendaParaNfse): {
  readonly amountCents: number
  readonly discountCents: number
  readonly description: string
  readonly nbsCode: string | undefined
} {
  const servicos = venda.items.filter(eServico)
  const total = (i: ItemDaVendaParaNfse) => i.unitPriceCents * i.quantity
  const amountCents = servicos.reduce((s, i) => s + total(i), 0)

  const discountCents =
    venda.grossAmountCents > 0 && venda.discountCents > 0
      ? Math.round((venda.discountCents * amountCents) / venda.grossAmountCents)
      : 0

  const maior = [...servicos].sort((a, b) => total(b) - total(a))[0]
  const description = servicos
    .map((i) => `${i.quantity}x ${i.description}`)
    .join('; ')
    .slice(0, 1000)

  return {
    amountCents,
    discountCents,
    description,
    nbsCode: maior?.nbsCode ?? undefined,
  }
}

/** A guarda para o que a tela le. */
export function paraTela(n: NfseGuardada): SaleServiceInvoiceOutput {
  return {
    status: n.status,
    amountCents: n.amountCents,
    discountCents: n.discountCents,
    description: n.description,
    number: n.number,
    accessKey: n.accessKey,
    verificationCode: n.verificationCode,
    danfseUrl: n.danfseUrl,
    publicUrl: n.publicUrl,
    rejection: n.rejection,
    requestedAt: n.requestedAt,
    issuedAt: n.issuedAt,
    cancelledAt: n.cancelledAt,
  }
}

export type RequestServiceInvoiceDeps = {
  readonly nfse: ServiceInvoiceRepository
  readonly queue: Pick<ServiceInvoiceQueue, 'enqueueIssue'>
  readonly cities: CityCodeLookup
}

/**
 * Pedir a NFS-e da venda.
 *
 * Idempotente: venda que ja tem nota processando ou autorizada devolve a que
 * tem. So a rejeitada e pedida de novo — e a correcao do lojista.
 */
export async function requestServiceInvoice(
  deps: RequestServiceInvoiceDeps,
  ctx: ExecutionContext,
  input: { readonly saleId: string },
): Promise<SaleServiceInvoiceOutput> {
  assertCanWrite(ctx)

  const existente = await deps.nfse.find(ctx.companyId, input.saleId)
  if (existente !== undefined && existente.status !== 'rejected') {
    if (existente.status === 'cancelled') {
      throw AppError.conflict(
        'A NFS-e desta venda foi cancelada. Uma venda não emite uma segunda NFS-e. Nada foi alterado.',
      )
    }
    return paraTela(existente)
  }

  const venda = await deps.nfse.saleForNfse(ctx.companyId, input.saleId)
  /* De outra empresa responde como inexistente, nunca como proibida. */
  if (venda === undefined) throw AppError.notFound('Venda não encontrada.')

  if (!venda.items.some(eServico)) {
    throw AppError.validation(
      'Esta venda não tem serviço. A NFS-e é só para serviços: no cadastro do produto, ' +
        'o serviço tem o NBS preenchido. Para mercadoria, emita a NFC-e.',
    )
  }

  const empresa = await deps.nfse.companyForNfse(ctx.companyId)
  if (empresa === undefined) throw AppError.notFound('Empresa não encontrada.')

  if (empresa.nationalServiceCode === null) {
    throw AppError.validation(
      'Para emitir a NFS-e, informe o Código de Tributação Nacional em Empresa, nos dados fiscais.',
      [{ path: 'nationalServiceCode', message: 'Código de Tributação Nacional não informado.' }],
    )
  }

  const cityIbgeCode = await codigoDaCidade(deps, ctx, empresa)

  const servico = montarServico(venda)
  if (servico.discountCents >= servico.amountCents) {
    throw AppError.validation(
      'O desconto da venda cobre todo o valor dos serviços, e a NFS-e não sai com valor zero.',
    )
  }

  const documento = venda.customer?.document?.replace(/\D/g, '')
  const tomador =
    documento !== undefined && (documento.length === 11 || documento.length === 14)
      ? {
          document: documento,
          ...(venda.customer?.name === undefined || venda.customer.name.trim().length < 2
            ? {}
            : { name: venda.customer.name.trim().slice(0, 150) }),
          ...(venda.customer?.email === undefined ? {} : { email: venda.customer.email }),
        }
      : undefined

  const pedido: ServiceInvoiceRequest = {
    companyId: ctx.companyId,
    saleId: venda.saleId,
    provider: {
      cnpj: empresa.cnpj,
      ...(empresa.municipalRegistration === null
        ? {}
        : { municipalRegistration: empresa.municipalRegistration }),
      cityIbgeCode,
      simplesNacional: opcaoDoSimples(empresa.taxRegime),
    },
    service: {
      nationalServiceCode: empresa.nationalServiceCode,
      ...(servico.nbsCode === undefined ? {} : { nbsCode: servico.nbsCode }),
      description: servico.description,
      amountCents: servico.amountCents,
      ...(servico.discountCents === 0 ? {} : { discountCents: servico.discountCents }),
      ...(empresa.issRatePercent === null ? {} : { issRatePercent: empresa.issRatePercent }),
    },
    ...(tomador === undefined ? {} : { recipient: tomador }),
    competenceDate: diaDeCompetencia(venda.soldAt),
    requestedAt: ctx.now.toISOString(),
  }

  /* O mesmo schema que o emissor usa: "valido aqui" e "valido la" nao podem
     divergir, e o erro sai em portugues agora, nao numa rejeicao depois. */
  const validado = serviceInvoiceRequestSchema.safeParse(pedido)
  if (!validado.success) {
    const primeiro = validado.error.issues[0]
    throw AppError.validation(
      `Dados da NFS-e inválidos: ${primeiro?.message ?? 'confira o cadastro da empresa e do cliente.'}`,
    )
  }

  const abriu = await deps.nfse.open(ctx.companyId, venda.saleId, {
    amountCents: servico.amountCents,
    discountCents: servico.discountCents,
    description: servico.description,
    requestedAt: ctx.now,
  })

  /* So quem abriu enfileira: se outro clique chegou antes, a nota dele ja
     esta a caminho, e uma segunda na fila seria envio em dobro. */
  if (abriu) await deps.queue.enqueueIssue(pedido)

  const guardada = await deps.nfse.find(ctx.companyId, venda.saleId)
  if (guardada === undefined) throw AppError.notFound('Venda não encontrada.')
  return paraTela(guardada)
}

/** O codigo IBGE da cidade da loja: o guardado, ou achado pelo nome e guardado. */
async function codigoDaCidade(
  deps: RequestServiceInvoiceDeps,
  ctx: ExecutionContext,
  empresa: { cityIbgeCode: string | null; city: string | null; state: string | null },
): Promise<string> {
  if (empresa.cityIbgeCode !== null) return empresa.cityIbgeCode

  const cidade = empresa.city?.trim() ?? ''
  const uf = empresa.state?.trim() ?? ''
  if (cidade === '' || uf === '') {
    throw AppError.validation(
      'Para emitir a NFS-e, preencha a cidade e a UF da empresa em Empresa, no endereço.',
    )
  }

  let codigo: string | undefined
  try {
    codigo = await deps.cities.codigoIbge(uf, cidade)
  } catch (erro) {
    if (!(erro instanceof ErroDeIntegracao)) throw erro
    throw AppError.conflict(
      'Não deu para confirmar o código IBGE da cidade da loja agora. Tente de novo em alguns minutos.',
    )
  }

  if (codigo === undefined) {
    throw AppError.validation(
      `Não encontramos a cidade "${cidade}/${uf}" na lista do IBGE. Confira a cidade e a UF ` +
        'da empresa em Empresa, no endereço.',
    )
  }

  await deps.nfse.saveCityCode(ctx.companyId, codigo)
  return codigo
}

export type ServiceInvoiceJobDeps = {
  readonly nfse: Pick<ServiceInvoiceRepository, 'find' | 'record'>
  readonly issuer: Pick<ServiceInvoiceIssuer, 'issue' | 'consult'>
  readonly queue: Pick<ServiceInvoiceQueue, 'enqueueCheck'>
  readonly now: () => Date
}

/**
 * O trabalho da fila: envia a nota e, se ela ficar "processando", agenda a
 * primeira consulta. Falha de infraestrutura SOBE — o job tenta de novo, e o
 * emissor consulta antes de reenviar.
 */
export async function issueServiceInvoiceJob(
  deps: ServiceInvoiceJobDeps,
  pedido: ServiceInvoiceRequest,
): Promise<ServiceInvoiceResult> {
  const r = await deps.issuer.issue(pedido)
  await deps.nfse.record(pedido.companyId, pedido.saleId, r, deps.now())
  if (r.status === 'processing') {
    await deps.queue.enqueueCheck(
      { companyId: pedido.companyId, saleId: pedido.saleId, checks: 0 },
      esperaDaConsulta(0),
    )
  }
  return r
}

/**
 * Consulta de novo uma nota "processando". Para quando ela sai desse estado,
 * ou depois de `CONSULTAS_MAXIMAS` — dali em diante, quem consulta e a tela.
 */
export async function checkServiceInvoiceJob(
  deps: ServiceInvoiceJobDeps,
  job: ServiceInvoiceCheck,
): Promise<ServiceInvoiceResult | 'nada-a-fazer'> {
  const atual = await deps.nfse.find(job.companyId, job.saleId)
  if (atual === undefined || atual.status !== 'processing') return 'nada-a-fazer'

  /* Sem nota na Focus: o envio ainda esta na fila (ou tentando de novo).
     Conta a consulta e espera, sem gravar nada. */
  const r = (await deps.issuer.consult({ companyId: job.companyId, saleId: job.saleId })) ?? {
    status: 'processing' as const,
  }

  await deps.nfse.record(job.companyId, job.saleId, r, deps.now())

  const proxima = job.checks + 1
  if (r.status === 'processing' && proxima < CONSULTAS_MAXIMAS) {
    await deps.queue.enqueueCheck({ ...job, checks: proxima }, esperaDaConsulta(proxima))
  }
  return r
}

export type GetServiceInvoiceDeps = {
  readonly nfse: Pick<ServiceInvoiceRepository, 'find' | 'record'>
  readonly issuer?: Pick<ServiceInvoiceIssuer, 'consult'>
}

/**
 * A NFS-e da venda para a tela. Se ela segue "processando", aproveita a
 * visita para perguntar ao provedor — no maximo a cada 20 s.
 */
export async function getSaleServiceInvoice(
  deps: GetServiceInvoiceDeps,
  ctx: ExecutionContext,
  input: { readonly saleId: string },
): Promise<SaleServiceInvoiceOutput | null> {
  const nota = await deps.nfse.find(ctx.companyId, input.saleId)
  if (nota === undefined) return null
  if (nota.status !== 'processing' || deps.issuer === undefined) return paraTela(nota)

  const ultima = nota.lastCheckedAt === null ? 0 : Date.parse(nota.lastCheckedAt)
  if (ctx.now.getTime() - ultima < INTERVALO_DA_CONSULTA_NA_TELA_MS) return paraTela(nota)

  try {
    const r = await deps.issuer.consult({ companyId: ctx.companyId, saleId: input.saleId })
    if (r === undefined) return paraTela(nota)
    await deps.nfse.record(ctx.companyId, input.saleId, r, ctx.now)
  } catch (erro) {
    /* Provedor fora do ar nao derruba a tela: ela mostra o que ja sabe. */
    if (!(erro instanceof ErroDeIntegracao)) throw erro
    return paraTela(nota)
  }

  const atualizada = await deps.nfse.find(ctx.companyId, input.saleId)
  return atualizada === undefined ? null : paraTela(atualizada)
}

export type CancelServiceInvoiceDeps = {
  readonly nfse: Pick<ServiceInvoiceRepository, 'find' | 'markCancelled'>
  readonly issuer: Pick<ServiceInvoiceIssuer, 'cancel'>
  readonly audit: AuditTrail
}

/** Cancelar a NFS-e autorizada da venda. O prazo e regra do Ambiente Nacional. */
export async function cancelSaleServiceInvoice(
  deps: CancelServiceInvoiceDeps,
  ctx: ExecutionContext,
  input: { readonly saleId: string; readonly reason: string },
): Promise<SaleServiceInvoiceOutput> {
  assertCanWrite(ctx)

  const nota = await deps.nfse.find(ctx.companyId, input.saleId)
  if (nota === undefined || nota.status === 'rejected') {
    throw AppError.notFound('Esta venda não tem NFS-e válida para cancelar.')
  }
  if (nota.status === 'cancelled') return paraTela(nota)
  if (nota.status === 'processing') {
    throw AppError.conflict(
      'A NFS-e ainda está processando. Espere a autorização para cancelar. Nada foi alterado.',
    )
  }

  const r = await deps.issuer.cancel({
    companyId: ctx.companyId,
    saleId: input.saleId,
    reason: input.reason,
  })

  if (r.status === 'rejected') {
    throw AppError.validation(r.rejection.message, [
      { path: 'reason', message: r.rejection.message },
    ])
  }

  await deps.nfse.markCancelled(ctx.companyId, input.saleId, input.reason, ctx.now)

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Sale',
    entityId: input.saleId,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { serviceInvoice: 'authorized', number: nota.number },
    after: { serviceInvoice: 'cancelled', reason: input.reason },
  })

  const cancelada = await deps.nfse.find(ctx.companyId, input.saleId)
  return paraTela(cancelada ?? nota)
}
