import { describe, expect, it } from 'vitest'
import { createQuoteInputSchema } from '@na-regua/contracts'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { InMemoryQuotes } from './fakes.js'
import { cancelQuote, convertQuote, createQuote, getQuote, listQuotes } from './quotes.js'

/** Orcamento — NR-159. */

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: new Date('2026-10-07T12:00:00.000Z'),
    ...over,
  }
}

function montar() {
  const quotes = new InMemoryQuotes()
  quotes.cadastrar({ id: 'p1', companyId: 'emp-1', description: 'Tinta 18L', isActive: true })
  quotes.cadastrar({ id: 'p2', companyId: 'emp-1', description: 'Rolo', isActive: true })
  quotes.cadastrar({ id: 'p3', companyId: 'emp-1', description: 'Antigo', isActive: false })
  quotes.cadastrar({ id: 'px', companyId: 'emp-2', description: 'Outra loja', isActive: true })
  const audit = new InMemoryAuditTrail()
  return { quotes, audit, deps: { quotes, audit } }
}

const entrada = (over: Record<string, unknown> = {}) =>
  createQuoteInputSchema.parse({
    customerName: 'Joana',
    items: [
      { productId: 'p1', quantity: 2, unitPriceCents: 30000 },
      { productId: 'p2', quantity: 3, unitPriceCents: 1500 },
    ],
    validUntil: '2026-10-17',
    discountCents: 500,
    ...over,
  })

const erroDe = (p: Promise<unknown>) => p.then(() => undefined).catch((e) => e)

describe('orcamento — NR-159', () => {
  it('grava com numero da loja, total com desconto e descricao do produto', async () => {
    const { deps, audit } = montar()
    const q = await createQuote(deps, ctx(), entrada())
    expect(q).toMatchObject({ number: 1, status: 'open', totalCents: 64000, customerName: 'Joana' })
    expect(q.items.map((i) => i.description)).toEqual(['Tinta 18L', 'Rolo'])
    expect((await createQuote(deps, ctx(), entrada())).number).toBe(2)
    expect(audit.daEmpresa('emp-1')[0]).toMatchObject({ entity: 'Quote', action: 'created' })
  })

  it('desconto maior que o total e recusado', async () => {
    const { deps } = montar()
    const e = await erroDe(createQuote(deps, ctx(), entrada({ discountCents: 999_999 })))
    expect(isAppError(e) && e.code).toBe('VALIDATION_FAILED')
  })

  it('produto inativo nao entra; de outra loja nao existe', async () => {
    const { deps } = montar()
    const inativo = await erroDe(
      createQuote(
        deps,
        ctx(),
        entrada({ items: [{ productId: 'p3', quantity: 1, unitPriceCents: 1 }] }),
      ),
    )
    expect(isAppError(inativo) && inativo.code).toBe('CONFLICT')
    const outra = await erroDe(
      createQuote(
        deps,
        ctx(),
        entrada({ items: [{ productId: 'px', quantity: 1, unitPriceCents: 1 }] }),
      ),
    )
    expect(isAppError(outra) && outra.code).toBe('NOT_FOUND')
  })

  it('converte registrando a venda, e nao converte duas vezes', async () => {
    const { deps, quotes } = montar()
    const q = await createQuote(deps, ctx(), entrada())
    quotes.registrarVenda('venda-1', 'emp-1')

    const convertido = await convertQuote(deps, ctx(), q.id, { saleId: 'venda-1' })
    expect(convertido).toMatchObject({ status: 'converted', saleId: 'venda-1' })

    const de_novo = await erroDe(convertQuote(deps, ctx(), q.id, { saleId: 'venda-1' }))
    expect(isAppError(de_novo) && de_novo.code).toBe('CONFLICT')
  })

  it('venda de outra loja nao converte', async () => {
    const { deps, quotes } = montar()
    const q = await createQuote(deps, ctx(), entrada())
    quotes.registrarVenda('venda-x', 'emp-2')
    const e = await erroDe(convertQuote(deps, ctx(), q.id, { saleId: 'venda-x' }))
    expect(isAppError(e) && e.code).toBe('NOT_FOUND')
  })

  it('cancela, e cancelado nao converte', async () => {
    const { deps, quotes } = montar()
    const q = await createQuote(deps, ctx(), entrada())
    expect((await cancelQuote(deps, ctx(), q.id)).status).toBe('cancelled')
    quotes.registrarVenda('venda-1', 'emp-1')
    const e = await erroDe(convertQuote(deps, ctx(), q.id, { saleId: 'venda-1' }))
    expect(isAppError(e) && e.code).toBe('CONFLICT')
  })

  it('orcamento de outra loja nao aparece', async () => {
    const { deps } = montar()
    const q = await createQuote(deps, ctx(), entrada())
    const e = await erroDe(getQuote(deps, ctx({ companyId: 'emp-2' }), q.id))
    expect(isAppError(e) && e.code).toBe('NOT_FOUND')
    expect(await listQuotes(deps, ctx({ companyId: 'emp-2' }))).toEqual([])
  })

  it('perfil somente leitura nao orca', async () => {
    const { deps } = montar()
    const e = await erroDe(createQuote(deps, ctx({ role: 'accountant' }), entrada()))
    expect(isAppError(e) && e.code).toBe('FORBIDDEN')
  })
})
