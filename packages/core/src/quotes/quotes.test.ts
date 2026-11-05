import { describe, expect, it } from 'vitest'
import { createQuoteInputSchema } from '@na-regua/contracts'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { InMemoryQuotes } from './fakes.js'
import {
  cancelQuote,
  convertQuote,
  createQuote,
  getQuote,
  listQuotes,
  updateQuote,
} from './quotes.js'

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
  quotes.cadastrarCliente({ id: 'c1', companyId: 'emp-1', name: 'Joana Lima' })
  quotes.cadastrarCliente({ id: 'c2', companyId: 'emp-1', name: 'Pedro Alves' })
  quotes.cadastrarCliente({ id: 'cx', companyId: 'emp-2', name: 'De outra loja' })
  const audit = new InMemoryAuditTrail()
  return { quotes, audit, deps: { quotes, audit } }
}

const entrada = (over: Record<string, unknown> = {}) =>
  createQuoteInputSchema.parse({
    customerId: 'c1',
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
    expect(q).toMatchObject({
      number: 1,
      status: 'open',
      totalCents: 64000,
      customerId: 'c1',
      customerName: 'Joana Lima',
    })
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
    expect(convertido).toMatchObject({ status: 'converted', saleId: 'venda-1', saleNumber: 1 })

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

  it('cliente e obrigatorio e tem de ser do cadastro da loja', async () => {
    expect(createQuoteInputSchema.safeParse({ ...entrada(), customerId: undefined }).success).toBe(
      false,
    )
    /* O nome solto de antes nao passa mais: o cliente vem do cadastro. */
    expect(createQuoteInputSchema.safeParse({ ...entrada(), customerName: 'Joana' }).success).toBe(
      false,
    )

    const { deps } = montar()
    const inexistente = await erroDe(createQuote(deps, ctx(), entrada({ customerId: 'nao-ha' })))
    expect(isAppError(inexistente) && inexistente.code).toBe('VALIDATION_FAILED')
    const deOutra = await erroDe(createQuote(deps, ctx(), entrada({ customerId: 'cx' })))
    expect(isAppError(deOutra) && deOutra.code).toBe('VALIDATION_FAILED')
  })

  it('edita o orcamento aberto: cliente, itens e desconto novos, mesmo numero', async () => {
    const { deps, audit } = montar()
    const q = await createQuote(deps, ctx(), entrada())
    const editado = await updateQuote(
      deps,
      ctx(),
      q.id,
      entrada({
        customerId: 'c2',
        items: [{ productId: 'p2', quantity: 10, unitPriceCents: 1500 }],
        discountCents: 0,
        notes: 'Entrega na obra',
      }),
    )
    expect(editado).toMatchObject({
      id: q.id,
      number: q.number,
      status: 'open',
      customerId: 'c2',
      customerName: 'Pedro Alves',
      totalCents: 15000,
      notes: 'Entrega na obra',
    })
    expect(editado.items.map((i) => i.description)).toEqual(['Rolo'])
    expect((await getQuote(deps, ctx(), q.id)).totalCents).toBe(15000)
    expect(audit.daEmpresa('emp-1').at(-1)).toMatchObject({ entity: 'Quote', action: 'updated' })
  })

  it('a edicao cumpre as mesmas regras do novo', async () => {
    const { deps } = montar()
    const q = await createQuote(deps, ctx(), entrada())
    const desconto = await erroDe(
      updateQuote(deps, ctx(), q.id, entrada({ discountCents: 999_999 })),
    )
    expect(isAppError(desconto) && desconto.code).toBe('VALIDATION_FAILED')
    const inativo = await erroDe(
      updateQuote(
        deps,
        ctx(),
        q.id,
        entrada({ items: [{ productId: 'p3', quantity: 1, unitPriceCents: 1 }] }),
      ),
    )
    expect(isAppError(inativo) && inativo.code).toBe('CONFLICT')
    const cliente = await erroDe(updateQuote(deps, ctx(), q.id, entrada({ customerId: 'cx' })))
    expect(isAppError(cliente) && cliente.code).toBe('VALIDATION_FAILED')
  })

  it('convertido ou cancelado nao edita; de outra loja nao existe', async () => {
    const { deps, quotes } = montar()
    const convertido = await createQuote(deps, ctx(), entrada())
    quotes.registrarVenda('venda-1', 'emp-1')
    await convertQuote(deps, ctx(), convertido.id, { saleId: 'venda-1' })
    const e1 = await erroDe(updateQuote(deps, ctx(), convertido.id, entrada()))
    expect(isAppError(e1) && e1.code).toBe('CONFLICT')

    const cancelado = await createQuote(deps, ctx(), entrada())
    await cancelQuote(deps, ctx(), cancelado.id)
    const e2 = await erroDe(updateQuote(deps, ctx(), cancelado.id, entrada()))
    expect(isAppError(e2) && e2.code).toBe('CONFLICT')

    const aberto = await createQuote(deps, ctx(), entrada())
    const e3 = await erroDe(updateQuote(deps, ctx({ companyId: 'emp-2' }), aberto.id, entrada()))
    expect(isAppError(e3) && e3.code).toBe('NOT_FOUND')
    const e4 = await erroDe(updateQuote(deps, ctx({ role: 'accountant' }), aberto.id, entrada()))
    expect(isAppError(e4) && e4.code).toBe('FORBIDDEN')
  })
})
