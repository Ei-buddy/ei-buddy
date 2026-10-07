import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { addCashMovement, cashHistory, closeCash, currentCash, openCash } from './cash-register.js'
import { InMemoryCashRegister } from './fakes.js'

/** Abertura e fechamento de caixa — NR-157. */

const ABRIU = new Date('2026-10-07T11:00:00.000Z')

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: ABRIU,
    ...over,
  }
}

const depois = (min: number) => ctx({ now: new Date(ABRIU.getTime() + min * 60_000) })

function deps() {
  const cash = new InMemoryCashRegister()
  return { cash, audit: new InMemoryAuditTrail() }
}

const erroDe = (p: Promise<unknown>) => p.then(() => undefined).catch((e) => e)

describe('caixa — NR-157', () => {
  it('sem caixa aberto, o atual e nulo', async () => {
    expect(await currentCash(deps(), ctx())).toBeNull()
  })

  it('abre com o troco inicial, e o esperado comeca nele', async () => {
    const d = deps()

    const r = await openCash(d, ctx(), { openingCents: 10_000 })

    expect(r.session.status).toBe('open')
    expect(r.expectedCashCents).toBe(10_000)
  })

  it('so um caixa aberto por vez', async () => {
    const d = deps()
    await openCash(d, ctx(), { openingCents: 0 })

    const e = await erroDe(openCash(d, ctx(), { openingCents: 0 }))

    expect(isAppError(e) && e.code).toBe('CONFLICT')
  })

  it('esperado = troco + vendas em dinheiro + suprimento − sangria; pix so confere', async () => {
    const d = deps()
    await openCash(d, ctx(), { openingCents: 10_000 })
    d.cash.registrarVenda({
      companyId: 'emp-1',
      at: depois(10).now,
      pagamentos: [
        { method: 'cash', amountCents: 3_000 },
        { method: 'pix', amountCents: 2_000 },
      ],
    })
    /* Estornada nao entra, e venda antes da abertura tambem nao. */
    d.cash.registrarVenda({
      companyId: 'emp-1',
      at: depois(20).now,
      pagamentos: [{ method: 'cash', amountCents: 9_999 }],
      estornada: true,
    })
    d.cash.registrarVenda({
      companyId: 'emp-1',
      at: new Date(ABRIU.getTime() - 60_000),
      pagamentos: [{ method: 'cash', amountCents: 7_777 }],
    })
    await addCashMovement(d, depois(30), {
      kind: 'deposit',
      amountCents: 5_000,
      reason: 'Troco extra',
    })
    await addCashMovement(d, depois(40), {
      kind: 'withdrawal',
      amountCents: 8_000,
      reason: 'Deposito no banco',
    })

    const r = await currentCash(d, depois(50))

    expect(r?.expectedCashCents).toBe(10_000 + 3_000 + 5_000 - 8_000)
    expect(r?.salesByMethod).toContainEqual({ method: 'pix', amountCents: 2_000 })
    expect(r?.salesCount).toBe(1)
  })

  it('sangria maior que a gaveta e recusada', async () => {
    const d = deps()
    await openCash(d, ctx(), { openingCents: 1_000 })

    const e = await erroDe(
      addCashMovement(d, depois(5), { kind: 'withdrawal', amountCents: 1_001, reason: 'Teste' }),
    )

    expect(isAppError(e) && e.code).toBe('CONFLICT')
  })

  it('movimento sem caixa aberto e recusado', async () => {
    const e = await erroDe(
      addCashMovement(deps(), ctx(), { kind: 'deposit', amountCents: 100, reason: 'Teste' }),
    )

    expect(isAppError(e) && e.code).toBe('CONFLICT')
  })

  it('fechar grava esperado e contado, e a trilha guarda a diferenca', async () => {
    const d = deps()
    await openCash(d, ctx(), { openingCents: 10_000 })
    d.cash.registrarVenda({
      companyId: 'emp-1',
      at: depois(10).now,
      pagamentos: [{ method: 'cash', amountCents: 2_500 }],
    })

    const r = await closeCash(d, depois(60), { countedCents: 12_000 })

    expect(r.session).toMatchObject({
      status: 'closed',
      expectedCents: 12_500,
      countedCents: 12_000,
    })
    expect(d.audit.daEmpresa('emp-1').at(-1)?.after).toMatchObject({ differenceCents: -500 })
    expect(await currentCash(d, depois(61))).toBeNull()
    expect((await cashHistory(d, ctx()))[0]?.status).toBe('closed')
  })

  it('contador nao abre caixa', async () => {
    const e = await erroDe(openCash(deps(), ctx({ role: 'accountant' }), { openingCents: 0 }))

    expect(isAppError(e)).toBe(true)
  })
})
