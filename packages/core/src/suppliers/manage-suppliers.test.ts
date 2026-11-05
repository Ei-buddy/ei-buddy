import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { InMemorySuppliers } from './fakes.js'
import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from './manage-suppliers.js'

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  companyId: 'emp-1',
  userId: 'u-1',
  role: 'owner',
  channel: 'app',
  requestId: 'r-1',
  now: new Date('2026-11-05T12:00:00.000Z'),
  ...over,
})

const CNPJ = '11222333000181'

function deps() {
  return { suppliers: new InMemorySuppliers(), audit: new InMemoryAuditTrail() }
}

describe('cadastro de fornecedor — NR-191', () => {
  it('cadastra so com o nome, e o resto fica nulo', async () => {
    const d = deps()

    const f = await createSupplier(d, ctx(), { name: 'Distribuidora Boa Vista' })

    expect(f).toMatchObject({ name: 'Distribuidora Boa Vista', document: null, isActive: true })
    expect(f.address).toEqual({
      zipCode: null,
      street: null,
      number: null,
      complement: null,
      district: null,
      city: null,
      state: null,
    })
  })

  it('cadastra completo e audita', async () => {
    const d = deps()

    const f = await createSupplier(d, ctx(), {
      name: 'Boa Vista Comércio LTDA',
      tradeName: 'Boa Vista',
      document: CNPJ,
      stateRegistration: '123.456.789',
      phone: '4133334444',
      contactName: 'Carlos',
      address: { zipCode: '80010000', city: 'Curitiba', state: 'PR' },
    })

    expect(f).toMatchObject({ document: CNPJ, contactName: 'Carlos' })
    expect(f.address.city).toBe('Curitiba')
    expect(d.audit.daEmpresa('emp-1').map((e) => [e.entity, e.action])).toEqual([
      ['Supplier', 'created'],
    ])
  })

  it('o mesmo CNPJ duas vezes e recusado com o nome de quem ja tem', async () => {
    const d = deps()
    await createSupplier(d, ctx(), { name: 'Primeiro', document: CNPJ })

    const erro = await createSupplier(d, ctx(), { name: 'Segundo', document: CNPJ }).catch(
      (e: unknown) => e,
    )

    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    expect(isAppError(erro) && erro.message).toContain('Primeiro')
  })

  it('edita, inativa e some da lista de ativos', async () => {
    const d = deps()
    const f = await createSupplier(d, ctx(), { name: 'Atacado Sul', document: CNPJ })

    await updateSupplier(d, ctx(), f.id, { phone: '41999990000', isActive: false })

    expect(await listSuppliers(d, ctx(), {})).toEqual([])
    const todos = await listSuppliers(d, ctx(), { somenteAtivos: false })
    expect(todos[0]).toMatchObject({ phone: '41999990000', isActive: false })
  })

  it('busca sem acento e por palavra', async () => {
    const d = deps()
    await createSupplier(d, ctx(), { name: 'Laticínios São João' })
    await createSupplier(d, ctx(), { name: 'Padaria Central' })

    const r = await listSuppliers(d, ctx(), { q: 'joao laticinios' })

    expect(r.map((f) => f.name)).toEqual(['Laticínios São João'])
  })

  it('excluido sai da lista e nao abre; outra loja nao enxerga', async () => {
    const d = deps()
    const f = await createSupplier(d, ctx(), { name: 'Some Daqui' })

    await expect(getSupplier(d, ctx({ companyId: 'emp-2' }), f.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await deleteSupplier(d, ctx(), f.id)

    expect(await listSuppliers(d, ctx(), {})).toEqual([])
    await expect(getSupplier(d, ctx(), f.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('contador so le', async () => {
    const d = deps()
    const erro = await createSupplier(d, ctx({ role: 'accountant' }), { name: 'X Ltda' }).catch(
      (e: unknown) => e,
    )
    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })
})
