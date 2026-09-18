import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type { InventoryProductSnapshot } from '../ports/inventory-writers.js'
import { adjustStock } from './adjust-stock.js'
import { checkStock, checkStockByQuery, estaAbaixoDoMinimo } from './check-stock.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import { InMemoryInventory } from './fakes.js'
import type { ProductOutput } from '@na-regua/contracts'
import type { ProductRepository } from '../ports/registration-repositories.js'

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

const ARROZ: InventoryProductSnapshot = {
  id: 'prod-arroz',
  description: 'Arroz 5kg',
  salePriceCents: 2890,
  stockQuantity: 20,
  location: 'Corredor 3, prateleira B',
  minStock: 5,
}

/** Granel: existe, vende, e ninguem conta. `stockQuantity` nulo — RF-022. */
const GRANEL: InventoryProductSnapshot = {
  id: 'prod-granel',
  description: 'Feijao a granel',
  salePriceCents: 990,
  stockQuantity: null,
  location: null,
  minStock: null,
}

/*
 * A trilha vem de fora e entra na unidade de trabalho.
 *
 * Desde a NR-087 o ajuste audita DENTRO da propria transacao (`tx.record`), e
 * a trilha e a do escopo — nao mais uma nas dependencias. Quem quer inspecionar
 * le `inv.trilha`, que e a instancia em que o ajuste de fato escreve.
 */
function estoqueCom(...produtos: InventoryProductSnapshot[]): InMemoryInventory {
  const inv = new InMemoryInventory(new InMemoryAuditTrail())
  for (const p of produtos) inv.adicionarProduto('empresa-1', p)
  return inv
}

/* `AdjustStockDeps` perdeu o campo `audit` na NR-087: a trilha nao passa mais
   por aqui. Ver `TransactionalAuditTrail`. */
function deps(inv: InMemoryInventory) {
  return { uow: inv }
}

// ---------------------------------------------------------------------------
// Consulta — RF-022
// ---------------------------------------------------------------------------

function produtoBusca(over: Partial<ProductOutput> = {}): ProductOutput {
  return {
    id: 'prod-arroz',
    description: 'Arroz 5kg',
    barcode: null,
    internalCode: 'PROD-0001',
    unitOfMeasure: 'un',
    salePriceCents: 2890,
    costPriceCents: 1200,
    taxRate: 0,
    ncm: null,
    cfop: null,
    taxSituationCode: null,
    stock: 20,
    minStock: 5,
    category: null,
    supplier: null,
    ...over,
  }
}

function repositorioBusca(
  resultados: readonly ProductOutput[],
  ...produtos: InventoryProductSnapshot[]
) {
  const inv = estoqueCom(...produtos)
  return {
    products: {
      search: async () => resultados,
      findById: async () => undefined,
      findByBarcode: async () => undefined,
      create: async () => {
        throw new Error('nao deveria criar')
      },
      countAll: async () => 0,
      listCatalog: async () => ({ produtos: [], total: 0 }),
      catalogSummary: async () => ({
        total: 0,
        belowMinimum: 0,
        outOfStock: 0,
        stockValueCents: 0,
      }),
      listSuggestions: async () => ({ categories: [], suppliers: [] }),
    } satisfies ProductRepository,
    inventory: inv,
  }
}

describe('consultar estoque por texto — NR-115', () => {
  it('candidato unico devolve a visao de checkStock com localizacao', async () => {
    const deps = repositorioBusca([produtoBusca()], ARROZ)

    const r = await checkStockByQuery(deps, contexto(), { query: 'arroz' })

    expect(r.status).toBe('found')
    if (r.status !== 'found') return
    expect(r.view.stockQuantity).toBe(20)
    expect(r.view.location).toBe('Corredor 3, prateleira B')
    expect(r.view.salePriceCents).toBe(2890)
  })

  it('produto sem controle devolve nulo, nao zero', async () => {
    const deps = repositorioBusca(
      [produtoBusca({ id: 'prod-granel', description: 'Feijao a granel' })],
      GRANEL,
    )

    const r = await checkStockByQuery(deps, contexto(), { query: 'feijao' })

    expect(r.status).toBe('found')
    if (r.status !== 'found') return
    expect(r.view.stockQuantity).toBeNull()
    expect(r.view.stockQuantity).not.toBe(0)
  })

  it('saldo zero continua sendo zero', async () => {
    const deps = repositorioBusca([produtoBusca({ stock: 0 })], { ...ARROZ, stockQuantity: 0 })

    const r = await checkStockByQuery(deps, contexto(), { query: 'arroz' })

    expect(r.status).toBe('found')
    if (r.status !== 'found') return
    expect(r.view.stockQuantity).toBe(0)
  })

  it('busca sem resultado informa ausencia', async () => {
    const deps = repositorioBusca([])

    const r = await checkStockByQuery(deps, contexto(), { query: 'xyz' })

    expect(r).toEqual({ status: 'not_found' })
  })

  it('varios candidatos listam alternativas sem consultar saldo', async () => {
    const deps = repositorioBusca([
      produtoBusca({ id: 'p-azul', description: 'Camiseta M azul' }),
      produtoBusca({ id: 'p-branca', description: 'Camiseta M branca' }),
    ])

    const r = await checkStockByQuery(deps, contexto(), { query: 'camiseta' })

    expect(r.status).toBe('ambiguous')
    if (r.status !== 'ambiguous') return
    expect(r.alternatives).toHaveLength(2)
  })
})

describe('consultar estoque — RF-022', () => {
  it('devolve saldo, preco e localizacao', async () => {
    const inv = estoqueCom(ARROZ)

    const visao = await checkStock(inv, contexto(), { productId: 'prod-arroz' })

    expect(visao.stockQuantity).toBe(20)
    expect(visao.salePriceCents).toBe(2890)
    expect(visao.location).toBe('Corredor 3, prateleira B')
  })

  /**
   * O coracao da RF-022. Responder zero para o granel faria o balconista dizer
   * ao cliente que acabou, com a caixa cheia atras dele.
   */
  it('produto sem controle de estoque devolve nulo, NAO zero', async () => {
    const inv = estoqueCom(GRANEL)

    const visao = await checkStock(inv, contexto(), { productId: 'prod-granel' })

    expect(visao.stockQuantity).toBeNull()
    expect(visao.stockQuantity).not.toBe(0)
  })

  it('saldo zero continua sendo zero, e nao "sem controle"', async () => {
    const inv = estoqueCom({ ...ARROZ, stockQuantity: 0 })

    const visao = await checkStock(inv, contexto(), { productId: 'prod-arroz' })

    expect(visao.stockQuantity).toBe(0)
  })

  it('produto de outra empresa responde NOT_FOUND, nao FORBIDDEN', async () => {
    const inv = estoqueCom(ARROZ)

    try {
      await checkStock(inv, contexto({ companyId: 'empresa-2' }), { productId: 'prod-arroz' })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })

  it('produto inexistente responde NOT_FOUND', async () => {
    const inv = estoqueCom(ARROZ)

    try {
      await checkStock(inv, contexto(), { productId: 'prod-que-nao-existe' })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })

  it('accountant CONSULTA — somente leitura nao e sem acesso', async () => {
    const inv = estoqueCom(ARROZ)

    const visao = await checkStock(inv, contexto({ role: 'accountant' }), {
      productId: 'prod-arroz',
    })

    expect(visao.stockQuantity).toBe(20)
  })
})

describe('abaixo do minimo — RF-025', () => {
  it('acusa quando o saldo esta abaixo do minimo', async () => {
    const inv = estoqueCom({ ...ARROZ, stockQuantity: 3, minStock: 5 })

    const visao = await checkStock(inv, contexto(), { productId: 'prod-arroz' })

    expect(visao.belowMinimum).toBe(true)
  })

  it('saldo igual ao minimo ainda nao esta abaixo', () => {
    expect(estaAbaixoDoMinimo(5, 5)).toBe(false)
  })

  /* Se acusasse, o granel entraria na lista de compras todo dia — e lista que
     sempre acusa deixa de ser lida. */
  it('produto sem controle de estoque nunca esta abaixo do minimo', () => {
    expect(estaAbaixoDoMinimo(null, 5)).toBe(false)
  })

  it('produto sem minimo definido nunca esta abaixo', () => {
    expect(estaAbaixoDoMinimo(0, null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Ajuste — RF-023
// ---------------------------------------------------------------------------

describe('ajustar estoque — RF-023', () => {
  it('o saldo passa a ser o contado', async () => {
    const inv = estoqueCom(ARROZ)

    await adjustStock(deps(inv), contexto(), {
      productId: 'prod-arroz',
      countedQuantity: 18,
      reason: 'Contagem de inventario',
    })

    expect(inv.saldoDe('prod-arroz')).toBe(18)
  })

  it('grava o movimento com autoria, motivo e data', async () => {
    const inv = estoqueCom(ARROZ)

    const mov = await adjustStock(deps(inv), contexto({ userId: 'joana' }), {
      productId: 'prod-arroz',
      countedQuantity: 18,
      reason: 'Quebra de duas unidades',
    })

    expect(mov.createdBy).toBe('joana')
    expect(mov.reason).toBe('Quebra de duas unidades')
    expect(mov.createdAt).toBe(AGORA.toISOString())
    expect(mov.kind).toBe('adjustment')
  })

  it('a diferenca e assinada: contar menos da delta negativo', async () => {
    const inv = estoqueCom(ARROZ)

    const mov = await adjustStock(deps(inv), contexto(), {
      productId: 'prod-arroz',
      countedQuantity: 18,
      reason: 'Quebra',
    })

    expect(mov.quantityDelta).toBe(-2)
    expect(mov.balanceAfter).toBe(18)
  })

  it('contar mais da delta positivo — sobra tambem e divergencia', async () => {
    const inv = estoqueCom(ARROZ)

    const mov = await adjustStock(deps(inv), contexto(), {
      productId: 'prod-arroz',
      countedQuantity: 25,
      reason: 'Entrada nao lancada',
    })

    expect(mov.quantityDelta).toBe(5)
  })

  it('ajuste nao nasce de venda, entao saleId fica nulo', async () => {
    const inv = estoqueCom(ARROZ)

    const mov = await adjustStock(deps(inv), contexto(), {
      productId: 'prod-arroz',
      countedQuantity: 18,
      reason: 'Contagem',
    })

    expect(mov.saleId).toBeNull()
  })

  it('deixa exatamente um movimento na trilha', async () => {
    const inv = estoqueCom(ARROZ)

    await adjustStock(deps(inv), contexto(), {
      productId: 'prod-arroz',
      countedQuantity: 18,
      reason: 'Contagem',
    })

    expect(inv.movimentos).toHaveLength(1)
  })

  /* Tratar nulo como zero gravaria saldo em algo que por decisao nao tem
     saldo, e o produto passaria a ser contado sem ninguem ter pedido. */
  it('recusa ajustar produto sem controle de estoque', async () => {
    const inv = estoqueCom(GRANEL)

    try {
      await adjustStock(deps(inv), contexto(), {
        productId: 'prod-granel',
        countedQuantity: 10,
        reason: 'Tentando controlar',
      })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    }
  })

  it('recusa quando a contagem confere — nao ha o que ajustar', async () => {
    const inv = estoqueCom(ARROZ)

    try {
      await adjustStock(deps(inv), contexto(), {
        productId: 'prod-arroz',
        countedQuantity: 20,
        reason: 'Conferencia',
      })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    }
  })

  it('conferencia que bate nao suja a trilha', async () => {
    const inv = estoqueCom(ARROZ)

    await adjustStock(deps(inv), contexto(), {
      productId: 'prod-arroz',
      countedQuantity: 20,
      reason: 'Conferencia',
    }).catch(() => undefined)

    expect(inv.movimentos).toEqual([])
  })

  it('produto de outra empresa responde NOT_FOUND', async () => {
    const inv = estoqueCom(ARROZ)

    try {
      await adjustStock(deps(inv), contexto({ companyId: 'empresa-2' }), {
        productId: 'prod-arroz',
        countedQuantity: 18,
        reason: 'Contagem',
      })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })
})

/**
 * A verificacao de papel vive no caso de uso, e nao no handler HTTP — senao o
 * canal WhatsApp (NR-060) nao a aplicaria e o mesmo ajuste teria duas regras.
 */
describe('autorizacao por papel', () => {
  it.each(['owner', 'staff'] as const)('%s ajusta', async (role) => {
    const inv = estoqueCom(ARROZ)

    const mov = await adjustStock(deps(inv), contexto({ role }), {
      productId: 'prod-arroz',
      countedQuantity: 18,
      reason: 'Contagem',
    })

    expect(mov.id).toBeTruthy()
  })

  it('accountant NAO ajusta', async () => {
    const inv = estoqueCom(ARROZ)

    try {
      await adjustStock(deps(inv), contexto({ role: 'accountant' }), {
        productId: 'prod-arroz',
        countedQuantity: 18,
        reason: 'Contagem',
      })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
    }
  })

  it('accountant nao mexe no saldo nem por engano', async () => {
    const inv = estoqueCom(ARROZ)

    await adjustStock(deps(inv), contexto({ role: 'accountant' }), {
      productId: 'prod-arroz',
      countedQuantity: 18,
      reason: 'Contagem',
    }).catch(() => undefined)

    expect(inv.saldoDe('prod-arroz')).toBe(20)
  })
})

/**
 * Saldo mudado sem movimento e a trilha mentindo. As duas coisas entram juntas
 * ou nao entram — e o falso faz rollback de verdade para que este teste meça
 * atomicidade, e nao a boa vontade dele.
 */
describe('trilha de auditoria — RF-123', () => {
  it('o ajuste deixa autor, canal, data e antes/depois na trilha', async () => {
    const inv = estoqueCom(ARROZ)
    /* A trilha em que o ajuste de fato escreve: a do escopo da transacao. */
    const audit = inv.trilha

    await adjustStock(deps(inv), contexto({ userId: 'joana' }), {
      productId: 'prod-arroz',
      countedQuantity: 18,
      reason: 'Quebra',
    })

    const [entrada] = audit.daEmpresa('empresa-1')
    expect(entrada?.actorId).toBe('joana')
    expect(entrada?.channel).toBe('app')
    expect(entrada?.occurredAt).toBe(AGORA.toISOString())
    expect(entrada?.before).toEqual({ stockQuantity: 20 })
    expect(entrada?.after).toEqual({ stockQuantity: 18 })
  })

  /* O mesmo caso de uso pelos dois canais deixa a mesma trilha, com o canal
     distinguindo — e a promessa de que app e WhatsApp fazem a mesma coisa. */
  it('o mesmo ajuste pelo WhatsApp registra o canal, e nada mais muda', async () => {
    const inv = estoqueCom(ARROZ)
    const audit = inv.trilha

    await adjustStock(deps(inv), contexto({ channel: 'whatsapp' }), {
      productId: 'prod-arroz',
      countedQuantity: 18,
      reason: 'Quebra',
    })

    expect(audit.daEmpresa('empresa-1')[0]?.channel).toBe('whatsapp')
  })

  it('recusa nao deixa trilha — nao houve alteracao para registrar', async () => {
    const inv = estoqueCom(GRANEL)
    const audit = inv.trilha

    await adjustStock(deps(inv), contexto(), {
      productId: 'prod-granel',
      countedQuantity: 10,
      reason: 'Tentando controlar',
    }).catch(() => undefined)

    expect(audit.total).toBe(0)
  })

  /* Saldo mudado sem trilha e a trilha mentindo: as duas coisas entram juntas
     ou nao entram. */
  it('trilha indisponivel desfaz a mudanca de saldo', async () => {
    const inv = estoqueCom(ARROZ)
    const audit = inv.trilha
    audit.falharAoGravar = true

    await expect(
      adjustStock(deps(inv), contexto(), {
        productId: 'prod-arroz',
        countedQuantity: 18,
        reason: 'Quebra',
      }),
    ).rejects.toThrow()

    expect(inv.saldoDe('prod-arroz')).toBe(20)
    expect(inv.movimentos).toEqual([])
  })
})

describe('atomicidade', () => {
  it('falha ao gravar o movimento desfaz a mudanca de saldo', async () => {
    const inv = estoqueCom(ARROZ)
    inv.falharAoGravarMovimento = true

    await expect(
      adjustStock(deps(inv), contexto(), {
        productId: 'prod-arroz',
        countedQuantity: 18,
        reason: 'Contagem',
      }),
    ).rejects.toThrow()

    expect(inv.saldoDe('prod-arroz')).toBe(20)
    expect(inv.movimentos).toEqual([])
  })
})
