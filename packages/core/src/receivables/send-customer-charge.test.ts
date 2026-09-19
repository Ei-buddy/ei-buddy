import type { Role, SendMediaRequest, SendResult, SendTextRequest } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type { MessageSender } from '../ports/message-sender.js'
import { InMemoryCustomerRepository } from '../registration/fakes.js'
import { InMemoryReceivables } from './fakes.js'
import {
  sendCustomerCharge,
  textoDaCobrancaAoCliente,
  type SendCustomerChargeDeps,
  type WhatsappConsent,
  type WhatsappConsentReader,
} from './send-customer-charge.js'

const AGORA = new Date('2026-09-09T12:00:00.000Z')
const ACEITE = new Date('2026-01-15T10:00:00.000Z')

function contexto(sobrescreve: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner' as Role,
    channel: 'app',
    requestId: 'req-cobranca-1',
    now: AGORA,
    ...sobrescreve,
  }
}

class FakeMessageSender implements MessageSender {
  readonly enviadas: SendTextRequest[] = []
  recusa: Extract<SendResult, { status: 'rejected' }> | undefined

  async sendText(request: SendTextRequest): Promise<SendResult> {
    this.enviadas.push(request)
    if (this.recusa !== undefined) return this.recusa
    return {
      status: 'sent',
      messageId: `msg-${this.enviadas.length}`,
      to: request.to,
      sentAt: request.requestedAt,
    }
  }

  async sendMedia(_request: SendMediaRequest): Promise<SendResult> {
    throw new Error('sendMedia nao entra neste caso de uso')
  }

  readInbound(): never {
    throw new Error('readInbound nao entra neste caso de uso')
  }
}

class InMemoryWhatsappConsent implements WhatsappConsentReader {
  private readonly mapa = new Map<string, WhatsappConsent>()

  registrar(customerId: string, consent: WhatsappConsent): void {
    this.mapa.set(customerId, consent)
  }

  async of(_companyId: string, customerId: string): Promise<WhatsappConsent> {
    return this.mapa.get(customerId) ?? { optedInAt: null, optedOutAt: null }
  }
}

async function cenario(
  over: {
    readonly comDivida?: boolean
    readonly comConsentimento?: boolean
    readonly optedOut?: boolean
    readonly semTelefone?: boolean
    readonly outraEmpresa?: boolean
  } = {},
) {
  const customers = new InMemoryCustomerRepository()
  const receivables = new InMemoryReceivables()
  const messages = new FakeMessageSender()
  const consents = new InMemoryWhatsappConsent()

  const cliente = await customers.create({
    companyId: 'emp-1',
    name: 'Joao',
    ...(over.semTelefone === true ? {} : { phone: '11988887777' }),
    createdBy: 'usr-1',
    createdAt: AGORA,
  })

  if (over.comConsentimento !== false && over.optedOut !== true) {
    consents.registrar(cliente.id, { optedInAt: ACEITE, optedOutAt: null })
  }
  if (over.optedOut === true) {
    consents.registrar(cliente.id, { optedInAt: ACEITE, optedOutAt: AGORA })
  }

  if (over.comDivida !== false) {
    receivables.adicionar(over.outraEmpresa === true ? 'emp-2' : 'emp-1', {
      dueDate: '2026-09-01',
      customerId: cliente.id,
      customerName: 'Joao',
      description: 'Fiado',
      amountCents: 5_000,
    })
  }

  return { customers, receivables, messages, consents, cliente }
}

describe('sendCustomerCharge — US-052 / RF-107', () => {
  it('com divida e consentimento envia valor, vencimento e origem', async () => {
    const d = await cenario()

    const r = await sendCustomerCharge(d, contexto(), { customerId: d.cliente.id })

    expect(r).toEqual({
      status: 'sent',
      customerName: 'Joao',
      amountCents: 5_000,
      to: '5511988887777',
    })
    expect(d.messages.enviadas).toHaveLength(1)
    const pedido = d.messages.enviadas[0]
    expect(pedido?.consent).toEqual({
      basis: 'customer_opt_in',
      recordedAt: ACEITE.toISOString(),
    })
    expect(pedido?.body).toBe(
      textoDaCobrancaAoCliente({
        customerName: 'Joao',
        titulos: [{ amountCents: 5_000, dueDate: '2026-09-01', description: 'Fiado' }],
      }),
    )
    expect(pedido?.body).toContain('R$')
    expect(pedido?.body).toContain('01/09')
    expect(pedido?.body).toContain('Fiado')
    expect(pedido?.idempotencyKey).toBe('charge:req-cobranca-1')
  })

  it('resolve o cliente pelo telefone', async () => {
    const d = await cenario()

    const r = await sendCustomerCharge(d, contexto(), { phone: '11988887777' })

    expect(r.status).toBe('sent')
    expect(d.messages.enviadas).toHaveLength(1)
  })

  it('sem divida informa e nao envia', async () => {
    const d = await cenario({ comDivida: false })

    const r = await sendCustomerCharge(d, contexto(), { customerId: d.cliente.id })

    expect(r).toEqual({ status: 'nothing_to_charge', customerName: 'Joao' })
    expect(d.messages.enviadas).toHaveLength(0)
  })

  it('recebivel liquidado nao gera cobranca', async () => {
    const d = await cenario({ comDivida: false })
    d.receivables.adicionar('emp-1', {
      dueDate: '2026-09-01',
      customerId: d.cliente.id,
      customerName: 'Joao',
      status: 'settled',
      settledAmountCents: 5_000,
      amountCents: 5_000,
    })

    const r = await sendCustomerCharge(d, contexto(), { customerId: d.cliente.id })

    expect(r.status).toBe('nothing_to_charge')
    expect(d.messages.enviadas).toHaveLength(0)
  })

  it('sem consentimento recusa e nao envia — RF-070', async () => {
    const d = await cenario({ comConsentimento: false })

    try {
      await sendCustomerCharge(d, contexto(), { customerId: d.cliente.id })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
      expect((erro as Error).message).toMatch(/autorizou mensagens/i)
    }
    expect(d.messages.enviadas).toHaveLength(0)
  })

  it('opt-out recusa mesmo com aceite anterior', async () => {
    const d = await cenario({ optedOut: true })

    try {
      await sendCustomerCharge(d, contexto(), { customerId: d.cliente.id })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
      expect((erro as Error).message).toMatch(/nao receber mensagens/i)
    }
    expect(d.messages.enviadas).toHaveLength(0)
  })

  it('cliente de outra loja nao aparece', async () => {
    const d = await cenario()

    try {
      await sendCustomerCharge(d, contexto({ companyId: 'emp-2' }), { customerId: d.cliente.id })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
    expect(d.messages.enviadas).toHaveLength(0)
  })

  it('divida de outra loja nao e cobrada', async () => {
    const d = await cenario({ outraEmpresa: true })

    const r = await sendCustomerCharge(d, contexto(), { customerId: d.cliente.id })

    expect(r.status).toBe('nothing_to_charge')
    expect(d.messages.enviadas).toHaveLength(0)
  })

  it('accountant nao dispara cobranca', async () => {
    const d = await cenario()

    try {
      await sendCustomerCharge(d, contexto({ role: 'accountant' }), { customerId: d.cliente.id })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
    }
    expect(d.messages.enviadas).toHaveLength(0)
  })

  it('preserva idempotencyKey do contexto', async () => {
    const d = await cenario()

    await sendCustomerCharge(d, contexto({ idempotencyKey: 'agent:req-cobranca-1' }), {
      customerId: d.cliente.id,
    })

    expect(d.messages.enviadas[0]?.idempotencyKey).toBe('agent:req-cobranca-1')
  })
})

describe('link de pagamento na cobranca — RF-068', () => {
  const gatewayQueResponde = (url = 'https://www.asaas.com/c/link_1') =>
    ({
      createPaymentLink: async () => ({
        linkId: 'link_1',
        externalReference: 'req-cobranca-1',
        status: 'pending' as const,
        amountCents: 5_000,
        url,
        dueDate: null,
      }),
    }) as unknown as NonNullable<SendCustomerChargeDeps['gateway']>

  it('poe o link na mensagem e no resultado quando ha gateway', async () => {
    const d = await cenario()

    const r = await sendCustomerCharge({ ...d, gateway: gatewayQueResponde() }, contexto(), {
      customerId: d.cliente.id,
    })

    expect(r.status).toBe('sent')
    if (r.status !== 'sent') return
    expect(r.paymentLinkUrl).toBe('https://www.asaas.com/c/link_1')
    expect(d.messages.enviadas[0]?.body).toContain('https://www.asaas.com/c/link_1')
  })

  it('sem gateway a cobranca sai igual, so sem link', async () => {
    const d = await cenario()

    const r = await sendCustomerCharge(d, contexto(), { customerId: d.cliente.id })

    expect(r.status).toBe('sent')
    if (r.status !== 'sent') return
    expect(r.paymentLinkUrl).toBeUndefined()
    expect(d.messages.enviadas).toHaveLength(1)
  })

  /*
   * O lojista pediu para cobrar. O link e facilidade em cima disso — trocar
   * "mensagem sem link" por "nenhuma mensagem" pioraria o resultado para
   * proteger um detalhe.
   */
  it('provedor fora do ar nao derruba a cobranca', async () => {
    const d = await cenario()
    const quebrado = {
      createPaymentLink: async () => {
        throw new Error('Asaas fora do ar')
      },
    } as unknown as NonNullable<SendCustomerChargeDeps['gateway']>

    const r = await sendCustomerCharge({ ...d, gateway: quebrado }, contexto(), {
      customerId: d.cliente.id,
    })

    expect(r.status).toBe('sent')
    if (r.status !== 'sent') return
    expect(r.paymentLinkUrl).toBeUndefined()
    expect(d.messages.enviadas).toHaveLength(1)
  })

  it('o vencimento do link e o titulo mais proximo, nao o mais distante', async () => {
    const d = await cenario()
    d.receivables.adicionar('emp-1', {
      dueDate: '2026-12-30',
      customerId: d.cliente.id,
      customerName: 'Joao',
      description: 'Outro fiado',
      amountCents: 1_000,
    })
    const pedidos: { dueDate?: string }[] = []
    const espiao = {
      createPaymentLink: async (p: { dueDate?: string }) => {
        pedidos.push(p)
        return {
          linkId: 'l',
          externalReference: 'r',
          status: 'pending',
          amountCents: 1,
          url: 'https://x/y',
          dueDate: null,
        }
      },
    } as unknown as NonNullable<SendCustomerChargeDeps['gateway']>

    await sendCustomerCharge({ ...d, gateway: espiao }, contexto(), { customerId: d.cliente.id })

    expect(pedidos[0]?.dueDate).toBe('2026-09-01')
  })
})
