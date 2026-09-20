import type { PaymentEvent } from '@na-regua/contracts'
import type { ExecutionContext } from '../context.js'
import type { CustomerChargeRepository } from '../ports/customer-charge-repository.js'
import { settleReceivable, type SettleDeps } from '../settlements/settle.js'

export type SettleCustomerChargeDeps = SettleDeps & {
  readonly charges: CustomerChargeRepository
}

export type ResultadoDaBaixa = {
  readonly status: 'settled' | 'ignored'
  readonly motivo: string
  /** Quantos titulos receberam baixa. Zero quando ignorado. */
  readonly titulosBaixados: number
}

/**
 * O cliente pagou o link: os titulos cobertos recebem baixa — RF-068, RF-059.
 *
 * Fecha o caminho que a cobranca a distancia abria pela metade. O link saia
 * com uma referencia, e ate a NR-044 aquela referencia nao levava a lugar
 * nenhum: o pagamento entrava e o sistema seguia dizendo que o lojista tinha a
 * receber.
 *
 * ## Tres travas contra baixa em dobro
 *
 * Dinheiro dado como recebido duas vezes e o pior defeito possivel aqui, e o
 * provedor reentrega avisos de proposito. Por isso:
 *
 * 1. a caixa de entrada (`webhook_events`) barra o mesmo `eventId` na rota;
 * 2. `status = 'pending'` e conferido aqui — uma cobranca ja paga nao recebe
 *    baixa de novo, nem por um aviso com id diferente;
 * 3. o indice unico de `provider_event_id` barra no banco, mesmo que as duas
 *    primeiras falhem.
 *
 * As tres protegem o mesmo risco em camadas diferentes, e nenhuma torna a
 * outra dispensavel: a primeira e por aviso, a segunda por cobranca, a
 * terceira e a ultima linha.
 *
 * ## Um titulo por transacao, de proposito
 *
 * `settleReceivable` abre a propria transacao, e isso vale mais que atomicidade
 * entre titulos: a baixa de cada um audita e recalcula o saldo pelo caminho ja
 * testado. Se a terceira falhar, as duas primeiras estao baixadas e a cobranca
 * NAO e marcada como paga — reexecutar retoma de onde parou, porque uma baixa
 * repetida do mesmo titulo... e exatamente o que a trava 2 impede, ao manter a
 * cobranca pendente ate o fim.
 *
 * ## Sem usuario, com autoria declarada
 *
 * Quem "agiu" foi o cliente pagando, e nao alguem logado. O contexto e de JOB,
 * como no expurgo de conversa: `userId: 'job'`, canal `job`. A auditoria
 * registra isso, e e a verdade — inventar um usuario seria pior.
 */
export async function settleCustomerCharge(
  deps: SettleCustomerChargeDeps,
  evento: PaymentEvent,
  companyId: string,
  agora: Date,
): Promise<ResultadoDaBaixa> {
  if (evento.externalReference === null) {
    return { status: 'ignored', motivo: 'Aviso sem referencia.', titulosBaixados: 0 }
  }

  const cobranca = await deps.charges.porReferencia(companyId, evento.externalReference)

  if (cobranca === undefined) {
    /* Cobranca que nao e nossa — feita a mao no painel do provedor, por
       exemplo. Nao e erro, e tratar como erro faria o provedor reentregar. */
    return { status: 'ignored', motivo: 'Cobranca desconhecida.', titulosBaixados: 0 }
  }

  if (cobranca.status !== 'pending') {
    return { status: 'ignored', motivo: 'Cobranca ja baixada.', titulosBaixados: 0 }
  }

  const ctx: ExecutionContext = {
    companyId,
    userId: 'job',
    role: 'owner',
    channel: 'job',
    requestId: `webhook:${evento.eventId}`,
    now: agora,
  }

  /* Data de calendario: a baixa acontece num DIA, e o instante do aviso passa
     por fuso. Mesmo criterio de `due-date.ts`. */
  const dia = agora.toISOString().slice(0, 10)

  for (const titulo of cobranca.titulos) {
    await settleReceivable(deps, ctx, {
      receivableId: titulo.receivableId,
      amountCents: titulo.amountCents,
      /* O meio e `pix` porque e o que o link entrega no fim — o provedor
         aceita boleto e cartao pelo mesmo link, e distinguir exigiria um campo
         que o aviso de pagamento nao traz hoje. Anotado na observacao para o
         lojista nao ficar sem saber de onde veio. */
      method: 'pix',
      settledOn: dia,
      notes: `Pagamento do link enviado ao cliente (${evento.eventId}).`,
    })
  }

  await deps.charges.marcarPaga({
    companyId,
    chargeId: cobranca.id,
    providerEventId: evento.eventId,
    paidAt: agora,
  })

  return {
    status: 'settled',
    motivo: 'Titulos baixados pelo pagamento do link.',
    titulosBaixados: cobranca.titulos.length,
  }
}
