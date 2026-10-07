import type { CreatePayableInput } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { cancelPayable, updatePayable } from './change-payable.js'
import { createPayable } from './create-payable.js'
import { InMemoryPayables } from './fakes.js'

/** Corrigir e cancelar conta a pagar — NR-150. */

const AGORA = new Date('2026-09-02T12:00:00.000Z')

function contexto(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'empresa-1',
    userId: 'usuario-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...over,
  }
}

const conta: CreatePayableInput = {
  supplier: 'Copel',
  description: 'Energia da loja',
  amountCents: 48_000,
  dueDate: '2026-09-10',
}

async function comConta() {
  const audit = new InMemoryAuditTrail()
  const pag = new InMemoryPayables(audit)
  const d = { uow: pag, ids: pag, audit, pag }
  const [criada] = await createPayable(d, contexto(), conta)
  return { d, id: criada!.id }
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

describe('corrigir conta a pagar — NR-150', () => {
  it('muda so o que veio, o resto fica', async () => {
    const { d, id } = await comConta()

    const nova = await updatePayable(d, contexto(), id, { amountCents: 51_000 })

    expect(nova.amountCents).toBe(51_000)
    expect(nova.supplier).toBe('Copel')
    expect(nova.dueDate).toBe('2026-09-10')
  })

  it('registra antes e depois na auditoria', async () => {
    const { d, id } = await comConta()

    await updatePayable(d, contexto(), id, { dueDate: '2026-09-15' })

    const ultimo = d.audit.daEmpresa('empresa-1').at(-1)
    expect(ultimo?.action).toBe('updated')
    expect(ultimo?.before).toMatchObject({ dueDate: '2026-09-10' })
    expect(ultimo?.after).toMatchObject({ dueDate: '2026-09-15' })
  })

  it('com pagamento registrado, recusa: estorne antes', async () => {
    const { d, id } = await comConta()
    d.pag.simularBaixa(id, 10_000)

    const e = await erroDe(updatePayable(d, contexto(), id, { amountCents: 1 }))

    expect(e.code).toBe('CONFLICT')
  })

  it('nao acha conta de outra empresa', async () => {
    const { d, id } = await comConta()

    const e = await erroDe(
      updatePayable(d, contexto({ companyId: 'empresa-2' }), id, { amountCents: 1 }),
    )

    expect(e.code).toBe('NOT_FOUND')
  })

  it('contador so le, nao corrige', async () => {
    const { d, id } = await comConta()

    await expect(
      updatePayable(d, contexto({ role: 'accountant' }), id, { amountCents: 1 }),
    ).rejects.toThrow()
  })
})

describe('cancelar conta a pagar — NR-150', () => {
  it('cancela e guarda o motivo na auditoria', async () => {
    const { d, id } = await comConta()

    const cancelada = await cancelPayable(d, contexto(), id, { reason: 'Lancei em dobro' })

    expect(cancelada.status).toBe('cancelled')
    const ultimo = d.audit.daEmpresa('empresa-1').at(-1)
    expect(ultimo?.action).toBe('cancelled')
    expect(ultimo?.after).toMatchObject({ reason: 'Lancei em dobro' })
  })

  it('cancelada nao cancela de novo nem corrige', async () => {
    const { d, id } = await comConta()
    await cancelPayable(d, contexto(), id, { reason: 'Lancei em dobro' })

    expect((await erroDe(cancelPayable(d, contexto(), id, { reason: 'De novo' }))).code).toBe(
      'CONFLICT',
    )
    expect((await erroDe(updatePayable(d, contexto(), id, { amountCents: 1 }))).code).toBe(
      'CONFLICT',
    )
  })

  it('com pagamento registrado, recusa', async () => {
    const { d, id } = await comConta()
    d.pag.simularBaixa(id, 48_000)

    const e = await erroDe(cancelPayable(d, contexto(), id, { reason: 'Lancei em dobro' }))

    expect(e.code).toBe('CONFLICT')
  })
})
