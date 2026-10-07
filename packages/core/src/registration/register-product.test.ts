import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { Role } from '@na-regua/contracts'
import type { ExecutionContext } from '../context.js'
import { InMemoryProductRepository } from './fakes.js'
import {
  deleteProduct,
  listCatalog,
  registerProduct,
  searchProducts,
  updateProduct,
} from './register-product.js'

const AGORA = new Date('2026-09-02T13:00:00.000Z')

function contexto(sobrescreve: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner' as Role,
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...sobrescreve,
  }
}

const produtoValido = {
  description: 'Cafe torrado 500g',
  unitOfMeasure: 'un' as const,
  salePriceCents: 1990,
  costPriceCents: 1200,
  stock: 0,
  minStock: 5,
  category: 'Mercearia',
  supplier: 'Torrefacao Aurora',
}

describe('updateProduct', () => {
  async function comProduto() {
    const products = new InMemoryProductRepository()
    const p = await registerProduct({ products }, contexto(), produtoValido)
    return { products, id: p.id, original: p }
  }

  it('so os campos pedidos mudam; os outros ficam', async () => {
    const { products, id, original } = await comProduto()

    const atualizado = await updateProduct({ products }, contexto(), id, {
      salePriceCents: 2490,
    })

    expect(atualizado.salePriceCents).toBe(2490)
    expect(atualizado.costPriceCents).toBe(original.costPriceCents)
    expect(atualizado.description).toBe(original.description)
    expect(atualizado.minStock).toBe(original.minStock)
    expect(atualizado.category).toBe(original.category)
    expect(atualizado.supplier).toBe(original.supplier)
  })

  it('salePriceCents < costPriceCents depois do merge → VALIDATION_FAILED', async () => {
    const { products, id } = await comProduto()

    const erro = await updateProduct({ products }, contexto(), id, {
      salePriceCents: 500,
    }).catch((e: unknown) => e)

    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
  })

  it('produto de outra empresa responde NOT_FOUND', async () => {
    const { products, id } = await comProduto()

    const erro = await updateProduct({ products }, contexto({ companyId: 'emp-2' }), id, {
      description: 'Nao deveria gravar',
    }).catch((e: unknown) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})

describe('deleteProduct', () => {
  async function comProduto() {
    const products = new InMemoryProductRepository()
    const p = await registerProduct({ products }, contexto(), produtoValido)
    return { products, id: p.id }
  }

  it('marca como excluido; some da busca e do catalogo; findById nao acha', async () => {
    const { products, id } = await comProduto()

    await deleteProduct({ products }, contexto(), id)

    expect(await products.findById('emp-1', id)).toBeUndefined()

    const busca = await searchProducts({ products }, contexto(), { termo: 'Cafe' })
    expect(busca).toHaveLength(0)

    const catalogo = await listCatalog({ products }, contexto(), {
      stock: 'todos',
      page: 1,
      pageSize: 24,
    })
    expect(catalogo.total).toBe(0)
    expect(catalogo.products).toHaveLength(0)
  })

  it('segundo delete e sucesso idempotente', async () => {
    const { products, id } = await comProduto()

    await deleteProduct({ products }, contexto(), id)
    await expect(deleteProduct({ products }, contexto(), id)).resolves.toBeUndefined()
  })

  it('produto de outra empresa responde NOT_FOUND', async () => {
    const { products, id } = await comProduto()

    const erro = await deleteProduct({ products }, contexto({ companyId: 'emp-2' }), id).catch(
      (e: unknown) => e,
    )

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})
