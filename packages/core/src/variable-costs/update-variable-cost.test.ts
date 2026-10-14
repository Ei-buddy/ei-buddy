import type { VariableCostOutput } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import type { VariableCostRepository } from '../ports/variable-cost-repository.js'
import { updateVariableCost } from './manage-variable-costs.js'

/** Editar custo variavel — NR-152. */

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  companyId: 'emp-1',
  userId: 'usr-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: new Date('2026-09-02T12:00:00.000Z'),
  ...over,
})

function repo(custos: VariableCostOutput[]): VariableCostRepository & { ultimoBps?: number } {
  const r: VariableCostRepository & { ultimoBps?: number } = {
    list: async () => custos,
    findById: async (empresa, id) =>
      empresa === 'emp-1' ? custos.find((c) => c.id === id) : undefined,
    insert: async () => custos[0]!,
    remove: async () => undefined,
    update: async (_e, id, m) => {
      r.ultimoBps = m.rateBps
      const i = custos.findIndex((c) => c.id === id)
      custos[i] = { ...custos[i]!, name: m.name, ratePercent: m.rateBps / 100 }
      return custos[i]
    },
  }
  return r
}

const custo: VariableCostOutput = {
  id: 'v1',
  name: 'Tarifa',
  ratePercent: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('editar custo variavel — NR-152', () => {
  it('arredonda o percentual uma vez e deixa rastro', async () => {
    const audit = new InMemoryAuditTrail()
    const variableCosts = repo([{ ...custo }])

    const r = await updateVariableCost({ variableCosts, audit }, ctx(), 'v1', {
      name: 'Tarifa do cartao',
      ratePercent: 3.555,
    })

    expect(variableCosts.ultimoBps).toBe(356)
    expect(r.ratePercent).toBe(3.56)
    expect(audit.daEmpresa('emp-1')[0]).toMatchObject({
      action: 'updated',
      before: { ratePercent: 3 },
      after: { name: 'Tarifa do cartao' },
    })
  })

  it('contador nao edita', async () => {
    const d = { variableCosts: repo([{ ...custo }]), audit: new InMemoryAuditTrail() }

    const erro = await updateVariableCost(d, ctx({ role: 'accountant' }), 'v1', {
      name: 'X',
      ratePercent: 1,
    }).catch((e) => e)

    expect(isAppError(erro)).toBe(true)
  })

  it('de outra empresa responde NOT_FOUND', async () => {
    const d = { variableCosts: repo([{ ...custo }]), audit: new InMemoryAuditTrail() }

    const erro = await updateVariableCost(d, ctx({ companyId: 'emp-2' }), 'v1', {
      name: 'X',
      ratePercent: 1,
    }).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})
