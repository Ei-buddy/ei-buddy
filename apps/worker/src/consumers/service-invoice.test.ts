import type { ServiceInvoiceResult } from '@na-regua/contracts'
import type { NfseGuardada, ServiceInvoiceCheck, ServiceInvoiceJobDeps } from '@na-regua/core'
import { createFakeInvoiceIssuer } from '@na-regua/fiscal'
import { createFakeMessageSender } from '@na-regua/whatsapp'
import { describe, expect, it } from 'vitest'
import { QUEUES } from '../queues.js'
import { ehPermanente } from '../retry.js'
import { consumidorDe } from './index.js'
import { consumirConsultaDeServico, consumirEmissaoDeServico } from './service-invoice.js'
import type { ConsumerDeps } from './types.js'

/**
 * Os trabalhos da NFS-e nacional — NR-241. A regra (o que gravar, quando
 * consultar de novo) e testada em `core`; aqui, que o consumidor valida o
 * payload, chama o caso de uso e responde quando nao ha banco.
 */

const AGORA = new Date('2026-11-20T23:30:00.000Z')

const PEDIDO = {
  companyId: 'empresa-1',
  saleId: 'venda-1',
  provider: { cnpj: '12345678000195', cityIbgeCode: '4106902', simplesNacional: 'me_epp' },
  service: { nationalServiceCode: '060101', description: '1x Corte', amountCents: 6000 },
  competenceDate: '2026-11-20',
  requestedAt: AGORA.toISOString(),
}

function nfse(resposta: ServiceInvoiceResult) {
  const consultas: { check: ServiceInvoiceCheck; delayMs: number }[] = []
  const gravados: ServiceInvoiceResult[] = []
  const nota = { status: 'processing', checks: 0 } as NfseGuardada
  const deps: ServiceInvoiceJobDeps = {
    nfse: {
      find: async () => nota,
      record: async (_c, _s, r) => void gravados.push(r),
    },
    issuer: { issue: async () => resposta, consult: async () => resposta },
    queue: { enqueueCheck: async (check, delayMs) => void consultas.push({ check, delayMs }) },
    now: () => AGORA,
  }
  return { deps, consultas, gravados }
}

function deps(over: Partial<ConsumerDeps> = {}): ConsumerDeps {
  return {
    invoices: createFakeInvoiceIssuer(),
    messages: createFakeMessageSender(),
    overdue: { listOverdue: async () => [] },
    enqueue: { add: async () => {} },
    now: () => AGORA,
    conversations: {
      deleteMessagesOlderThan: async () => 0,
      closeConversationsWithoutMessages: async () => 0,
    },
    listTenantIds: async () => [],
    ...over,
  }
}

async function pegaErro(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}

describe('NFS-e nacional no worker — NR-241', () => {
  it('as duas filas tem consumidor', () => {
    expect(consumidorDe(QUEUES.serviceInvoiceIssue)).toBe(consumirEmissaoDeServico)
    expect(consumidorDe(QUEUES.serviceInvoiceCheck)).toBe(consumirConsultaDeServico)
  })

  it('envio "processando" grava e agenda a primeira consulta', async () => {
    const n = nfse({ status: 'processing' })
    const r = await consumirEmissaoDeServico(deps({ nfse: n.deps }), PEDIDO)
    expect(r.outcome).toBe('processing')
    expect(n.gravados).toEqual([{ status: 'processing' }])
    expect(n.consultas[0]?.check).toEqual({ companyId: 'empresa-1', saleId: 'venda-1', checks: 0 })
  })

  it('consulta que autoriza conclui sem agendar outra', async () => {
    const n = nfse({
      status: 'authorized',
      number: '1',
      danfseUrl: 'https://nfse.invalid/x.pdf',
      xmlPath: '/x.xml',
      issuedAt: '2026-11-20T20:31:00-03:00',
    })
    const r = await consumirConsultaDeServico(deps({ nfse: n.deps }), {
      companyId: 'empresa-1',
      saleId: 'venda-1',
      checks: 0,
    })
    expect(r.outcome).toBe('authorized')
    expect(n.consultas).toHaveLength(0)
  })

  it('payload invalido e falha permanente, nao retentativa', async () => {
    const n = nfse({ status: 'processing' })
    const erro = await pegaErro(() =>
      consumirEmissaoDeServico(deps({ nfse: n.deps }), { ...PEDIDO, saleId: '' }),
    )
    expect(ehPermanente(erro)).toBe(true)

    const erroConsulta = await pegaErro(() =>
      consumirConsultaDeServico(deps({ nfse: n.deps }), { saleId: 'venda-1' }),
    )
    expect(ehPermanente(erroConsulta)).toBe(true)
  })

  it('sem banco no worker, os dois trabalhos saem como "skipped"', async () => {
    expect((await consumirEmissaoDeServico(deps(), PEDIDO)).outcome).toBe('skipped')
    expect(
      (await consumirConsultaDeServico(deps(), { companyId: 'e', saleId: 'v', checks: 0 })).outcome,
    ).toBe('skipped')
  })
})
