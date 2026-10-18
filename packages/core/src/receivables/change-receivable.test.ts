import type { CreateReceivableInput } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { cancelReceivable, updateReceivable } from './change-receivable.js'
import { createReceivable } from './create-receivable.js'
import { InMemoryManualReceivables } from './fakes.js'

/** Corrigir e cancelar recebivel avulso — NR-150. */

const AGORA = new Date('2026-09-09T12:00:00.000Z')

function contexto(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...over,
  }
}

async function comRecebivel(over: Partial<CreateReceivableInput> = {}) {
  const audit = new InMemoryAuditTrail()
  const rec = new InMemoryManualReceivables(audit)
  const d = { uow: rec, audit, rec }
  const criado = await createReceivable(d, contexto(), {
    description: 'Aluguel de sala comercial',
    amountCents: 80_000,
    dueDate: '2026-09-15',
    ...over,
  })
  return { d, id: criado.id }
}

async function erroDe(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    if (isAppError(e)) return e
    throw e
  }
  throw new Error('deveria ter falhado')
}

describe('corrigir recebivel avulso — NR-150', () => {
  it('muda o valor, e o liquido acompanha', async () => {
    const { d, id } = await comRecebivel()

    const novo = await updateReceivable(d, contexto(), id, { amountCents: 90_000 })

    expect(novo.amountCents).toBe(90_000)
    expect(novo.netAmountCents).toBe(90_000)
    expect(novo.description).toBe('Aluguel de sala comercial')
  })

  it('fiado do cliente acompanha a diferenca', async () => {
    const { d, id } = await comRecebivel({ customerId: 'cli-1' })
    expect(d.rec.saldoDe('cli-1')).toBe(80_000)

    await updateReceivable(d, contexto(), id, { amountCents: 50_000 })

    expect(d.rec.saldoDe('cli-1')).toBe(50_000)
  })

  it('o que veio de venda se resolve na venda', async () => {
    const { d, id } = await comRecebivel()
    d.rec.simularDeVenda(id, 'venda-1')

    const e = await erroDe(updateReceivable(d, contexto(), id, { amountCents: 1 }))

    expect(e.code).toBe('CONFLICT')
    expect(e.message).toMatch(/venda/)
  })

  it('com recebimento registrado, recusa', async () => {
    const { d, id } = await comRecebivel()
    d.rec.simularBaixa(id, 10_000)

    const e = await erroDe(updateReceivable(d, contexto(), id, { amountCents: 1 }))

    expect(e.code).toBe('CONFLICT')
  })

  it('registra antes e depois na auditoria', async () => {
    const { d, id } = await comRecebivel()

    await updateReceivable(d, contexto(), id, { description: 'Aluguel de setembro' })

    const ultimo = d.audit.daEmpresa('emp-1').at(-1)
    expect(ultimo?.action).toBe('updated')
    expect(ultimo?.after).toMatchObject({ description: 'Aluguel de setembro' })
  })
})

describe('cancelar recebivel avulso — NR-150', () => {
  it('cancela e tira a divida do fiado', async () => {
    const { d, id } = await comRecebivel({ customerId: 'cli-1' })

    const cancelado = await cancelReceivable(d, contexto(), id, { reason: 'Cliente ja pagou' })

    expect(cancelado.status).toBe('cancelled')
    expect(d.rec.saldoDe('cli-1')).toBe(0)
    expect(d.audit.daEmpresa('emp-1').at(-1)?.after).toMatchObject({ reason: 'Cliente ja pagou' })
  })

  it('cancelado nao cancela de novo', async () => {
    const { d, id } = await comRecebivel()
    await cancelReceivable(d, contexto(), id, { reason: 'Lancei errado' })

    const e = await erroDe(cancelReceivable(d, contexto(), id, { reason: 'De novo' }))

    expect(e.code).toBe('CONFLICT')
  })

  it('o que veio de venda nao cancela aqui', async () => {
    const { d, id } = await comRecebivel()
    d.rec.simularDeVenda(id, 'venda-1')

    const e = await erroDe(cancelReceivable(d, contexto(), id, { reason: 'Lancei errado' }))

    expect(e.code).toBe('CONFLICT')
  })
})
