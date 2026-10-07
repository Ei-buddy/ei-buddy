import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { Role } from '@na-regua/contracts'
import type { ExecutionContext } from '../context.js'
import { InMemoryCustomerRepository, InMemoryProductRepository } from './fakes.js'
import { registerCustomer } from './register-customer.js'
import { registerProduct } from './register-product.js'
import { resolveCustomerRef, resolveProductRef } from './resolve-ref.js'

const AGORA = new Date('2026-09-02T13:00:00.000Z')

function contexto(sobrescreve: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner' as Role,
    channel: 'whatsapp',
    requestId: 'req-1',
    now: AGORA,
    ...sobrescreve,
  }
}

const produtoValido = {
  description: 'Cafe torrado 500g',
  unitOfMeasure: 'un' as const,
  salePriceCents: 2500,
  costPriceCents: 1000,
  stock: 0,
  minStock: 0,
}

describe('resolveProductRef', () => {
  it('id existente devolve o mesmo id', async () => {
    const products = new InMemoryProductRepository()
    const p = await registerProduct({ products }, contexto(), produtoValido)

    expect(await resolveProductRef({ products }, contexto(), p.id)).toBe(p.id)
  })

  it('nome unico resolve para o id', async () => {
    const products = new InMemoryProductRepository()
    const p = await registerProduct({ products }, contexto(), produtoValido)

    expect(await resolveProductRef({ products }, contexto(), 'cafe')).toBe(p.id)
  })

  it('nome que o postgres rejeitaria como uuid resolve pela busca', async () => {
    const products = new InMemoryProductRepository()
    const p = await registerProduct({ products }, contexto(), produtoValido)

    products.findById = async () => {
      throw new Error('invalid input syntax for type uuid: "cafe"')
    }

    expect(await resolveProductRef({ products }, contexto(), 'cafe')).toBe(p.id)
  })

  it('ausente lanca NOT_FOUND', async () => {
    const products = new InMemoryProductRepository()
    const erro = await resolveProductRef({ products }, contexto(), 'cafe').catch((e: unknown) => e)
    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  it('varios candidatos lanca VALIDATION com as alternativas', async () => {
    const products = new InMemoryProductRepository()
    await registerProduct({ products }, contexto(), produtoValido)
    await registerProduct({ products }, contexto(), {
      ...produtoValido,
      description: 'Cafe moido 250g',
    })

    const erro = await resolveProductRef({ products }, contexto(), 'cafe').catch((e: unknown) => e)
    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
    expect(String(erro)).toMatch(/mais de um/i)
    expect(String(erro)).toMatch(/Cafe torrado/)
    expect(String(erro)).toMatch(/Cafe moido/)
  })
})

describe('resolveCustomerRef', () => {
  it('id existente devolve o mesmo id', async () => {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto(), { name: 'Joao' })
    if (r.status !== 'created') throw new Error('esperava created')

    expect(await resolveCustomerRef({ customers }, contexto(), r.customer.id)).toBe(r.customer.id)
  })

  it('nome unico resolve para o id', async () => {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto(), { name: 'Joao' })
    if (r.status !== 'created') throw new Error('esperava created')

    expect(await resolveCustomerRef({ customers }, contexto(), 'Joao')).toBe(r.customer.id)
  })

  it('nome que o postgres rejeitaria como uuid resolve pela busca — roteiro #6', async () => {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto(), { name: 'teste' })
    if (r.status !== 'created') throw new Error('esperava created')

    customers.findById = async () => {
      throw new Error('invalid input syntax for type uuid: "teste"')
    }

    expect(await resolveCustomerRef({ customers }, contexto(), 'teste')).toBe(r.customer.id)
  })

  it('ausente lanca NOT_FOUND', async () => {
    const customers = new InMemoryCustomerRepository()
    const erro = await resolveCustomerRef({ customers }, contexto(), 'Joao').catch(
      (e: unknown) => e,
    )
    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  it('varios candidatos lanca VALIDATION com as alternativas', async () => {
    const customers = new InMemoryCustomerRepository()
    await registerCustomer({ customers }, contexto(), { name: 'Joao Silva' })
    await registerCustomer({ customers }, contexto(), { name: 'Joao Souza' })

    const erro = await resolveCustomerRef({ customers }, contexto(), 'Joao').catch(
      (e: unknown) => e,
    )
    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
    expect(String(erro)).toMatch(/mais de um/i)
    expect(String(erro)).toMatch(/Joao Silva/)
    expect(String(erro)).toMatch(/Joao Souza/)
  })
})
