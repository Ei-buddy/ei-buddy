import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createQuoteRepository } from './quote-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Orcamentos no banco — NR-159. O que so o SQL garante: numero por loja sem
 * repetir, itens na ordem montada com os dados atuais do produto, e fechar so
 * o que esta aberto.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('orcamentos — NR-159', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string
  let usuario: string
  let produtoA: string
  let produtoB: string
  let cliente: string
  let outroCliente: string
  let repo: ReturnType<typeof createQuoteRepository>

  async function produto(nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO products
          (id, company_id, description, internal_code, unit_of_measure,
           sale_price_cents, cost_price_cents, stock)
        VALUES (${id}, ${empresa}, ${nome}, ${`Q-${id.slice(0, 8)}`}, 'un', 2000, 900, 7)
      `,
    )
    return id
  }

  async function criarCliente(nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`INSERT INTO customers (id, company_id, name) VALUES (${id}, ${empresa}, ${nome})`,
    )
    return id
  }

  const novo = (itens: string[]) => ({
    companyId: empresa,
    customerId: cliente,
    customerName: 'Joana',
    validUntil: '2026-10-20',
    notes: null,
    discountCents: 0,
    totalCents: 4000,
    items: itens.map((productId, i) => ({
      productId,
      description: `Item ${i + 1}`,
      quantity: 1,
      unitPriceCents: 2000,
    })),
    createdBy: usuario,
    createdAt: new Date(),
  })

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql
    repo = createQuoteRepository(sql)

    empresa = randomUUID()
    const cnpj = cnpjDeTeste('4')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, 'Loja Orcamento', ${cnpj}, ${`x@${cnpj}.local`}, '41999990000')
      `,
    )
    usuario = randomUUID()
    await withTenant(sql, empresa, async (tx) => {
      await tx`INSERT INTO users (id, name, email) VALUES (${usuario}, 'Dono', ${`d${usuario}@local`})`
      await tx`INSERT INTO company_users (company_id, user_id, role) VALUES (${empresa}, ${usuario}, 'owner')`
    })
    produtoA = await produto('Tinta')
    produtoB = await produto('Rolo')
    cliente = await criarCliente('Joana')
    outroCliente = await criarCliente('Pedro')
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  it('numera por loja sem repetir, mesmo em paralelo', async () => {
    const feitos = await Promise.all([1, 2, 3].map(() => repo.create(novo([produtoA]))))
    expect(feitos.map((q) => q.number).sort()).toEqual([1, 2, 3])
  })

  it('itens na ordem montada, com o codigo e o saldo atuais', async () => {
    const q = await repo.create(novo([produtoB, produtoA]))
    expect(q.items.map((i) => i.description)).toEqual(['Item 1', 'Item 2'])
    expect(q.items[0]).toMatchObject({ productId: produtoB, stock: 7, costPriceCents: 900 })
    expect(q.validUntil).toBe('2026-10-20')

    const lida = await repo.findById(empresa, q.id)
    expect(lida?.items.map((i) => i.productId)).toEqual([produtoB, produtoA])
    expect(await repo.findById(empresa, 'nao-e-uuid')).toBeNull()
  })

  it('fecha so o que esta aberto, e convertido exige a venda', async () => {
    const q = await repo.create(novo([produtoA]))
    const cancelado = await repo.close(empresa, q.id, {
      status: 'cancelled',
      saleId: null,
      closedAt: new Date(),
    })
    expect(cancelado?.status).toBe('cancelled')
    expect(
      await repo.close(empresa, q.id, { status: 'cancelled', saleId: null, closedAt: new Date() }),
    ).toBeNull()

    const outro = await repo.create(novo([produtoA]))
    await expect(
      repo.close(empresa, outro.id, { status: 'converted', saleId: null, closedAt: new Date() }),
    ).rejects.toThrow(/quotes_desfecho_completo/)
  })

  it('convertido traz o numero da venda — NR-172', async () => {
    const venda = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO sales (id, company_id, number, status, gross_amount_cents, net_amount_cents,
                           created_at, created_by)
        VALUES (${venda}, ${empresa}, 77, 'settled', 4000, 4000, now(), ${usuario})
      `,
    )
    const q = await repo.create(novo([produtoA]))
    const fechado = await repo.close(empresa, q.id, {
      status: 'converted',
      saleId: venda,
      closedAt: new Date(),
    })
    expect(fechado).toMatchObject({ status: 'converted', saleId: venda, saleNumber: 77 })
    expect((await repo.findById(empresa, q.id))?.saleNumber).toBe(77)
  })

  it('venda inexistente ou de outra loja nao existe', async () => {
    expect(await repo.saleExists(empresa, randomUUID())).toBe(false)
    expect(await repo.saleExists(empresa, 'x')).toBe(false)
  })

  it('guarda o cliente do cadastro e o devolve na leitura', async () => {
    const q = await repo.create(novo([produtoA]))
    expect(q).toMatchObject({ customerId: cliente, customerName: 'Joana' })
    expect((await repo.findById(empresa, q.id))?.customerId).toBe(cliente)
    const pagina = await repo.list(empresa, { hoje: '2026-10-09', limite: 100, offset: 0 })
    expect(pagina.orcamentos.find((x) => x.id === q.id)?.customerId).toBe(cliente)
  })

  it('acha so cliente vivo da loja', async () => {
    expect(await repo.findCustomer(empresa, cliente)).toEqual({ id: cliente, name: 'Joana' })
    expect(await repo.findCustomer(empresa, 'nao-e-uuid')).toBeNull()
    expect(await repo.findCustomer(randomUUID(), cliente)).toBeNull()

    const apagado = await criarCliente('Apagado')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`UPDATE customers SET deleted_at = now() WHERE id = ${apagado}`,
    )
    expect(await repo.findCustomer(empresa, apagado)).toBeNull()
  })

  it('edita o aberto trocando cliente, itens e valores; numero fica', async () => {
    const q = await repo.create(novo([produtoA, produtoB]))
    const editado = await repo.update(empresa, q.id, {
      customerId: outroCliente,
      customerName: 'Pedro',
      validUntil: '2026-11-30',
      notes: 'Entrega na obra',
      discountCents: 100,
      totalCents: 5900,
      items: [{ productId: produtoB, description: 'Rolo', quantity: 3, unitPriceCents: 2000 }],
    })
    expect(editado).toMatchObject({
      id: q.id,
      number: q.number,
      status: 'open',
      customerId: outroCliente,
      customerName: 'Pedro',
      validUntil: '2026-11-30',
      notes: 'Entrega na obra',
      discountCents: 100,
      totalCents: 5900,
    })
    expect(editado?.items).toHaveLength(1)
    expect(editado?.items[0]).toMatchObject({ productId: produtoB, quantity: 3 })

    const lido = await repo.findById(empresa, q.id)
    expect(lido?.items.map((i) => i.productId)).toEqual([produtoB])
  })

  it('nao edita fechado, de outra loja ou id invalido', async () => {
    const mudancas = {
      customerId: cliente,
      customerName: 'Joana',
      validUntil: '2026-11-30',
      notes: null,
      discountCents: 0,
      totalCents: 2000,
      items: [{ productId: produtoA, description: 'Tinta', quantity: 1, unitPriceCents: 2000 }],
    }
    const q = await repo.create(novo([produtoA, produtoB]))
    await repo.close(empresa, q.id, { status: 'cancelled', saleId: null, closedAt: new Date() })
    expect(await repo.update(empresa, q.id, mudancas)).toBeNull()
    /* Os itens do cancelado ficam como estavam. */
    expect((await repo.findById(empresa, q.id))?.items).toHaveLength(2)

    const aberto = await repo.create(novo([produtoA]))
    expect(await repo.update(randomUUID(), aberto.id, mudancas)).toBeNull()
    expect(await repo.update(empresa, 'x', mudancas)).toBeNull()
  })

  describe('lista com painel, busca, periodo e situacao — NR-210', () => {
    let loja: string
    let dono: string
    const ids: Record<'q1' | 'q2' | 'q3' | 'q4' | 'q5', { id: string; number: number }> =
      {} as never

    /* Loja so deste bloco: o painel soma TUDO o que casa, e os orcamentos dos
       testes de cima mudariam as contas. */
    beforeAll(async () => {
      loja = randomUUID()
      dono = randomUUID()
      const cnpj = cnpjDeTeste('5')
      await withTenant(sql, loja, async (tx) => {
        await tx`
          INSERT INTO companies (id, legal_name, cnpj, email, phone)
          VALUES (${loja}, 'Loja Painel', ${cnpj}, ${`p@${cnpj}.local`}, '41999990001')
        `
        await tx`INSERT INTO users (id, name, email) VALUES (${dono}, 'Dono', ${`p${dono}@local`})`
        await tx`INSERT INTO company_users (company_id, user_id, role) VALUES (${loja}, ${dono}, 'owner')`
      })
      const prod = randomUUID()
      const ana = randomUUID()
      const bruno = randomUUID()
      await withTenant(sql, loja, async (tx) => {
        await tx`
          INSERT INTO products
            (id, company_id, description, internal_code, unit_of_measure,
             sale_price_cents, cost_price_cents, stock)
          VALUES (${prod}, ${loja}, 'Massa corrida', 'MC-1', 'un', 1000, 500, 3)
        `
        await tx`INSERT INTO customers (id, company_id, name) VALUES (${ana}, ${loja}, 'Ana Souza')`
        await tx`INSERT INTO customers (id, company_id, name) VALUES (${bruno}, ${loja}, 'Bruno Lima')`
      })

      const criar = (
        cliente: string,
        nome: string,
        totalCents: number,
        validUntil: string,
        createdAt: string,
        descricao = 'Massa corrida',
      ) =>
        repo.create({
          companyId: loja,
          customerId: cliente,
          customerName: nome,
          validUntil,
          notes: null,
          discountCents: 0,
          totalCents,
          items: [
            { productId: prod, description: descricao, quantity: 1, unitPriceCents: totalCents },
          ],
          createdBy: dono,
          createdAt: new Date(createdAt),
        })

      /* Hoje = 09/10. q1 e q3 abertos no prazo; q2 vencido; q4 cancelado; q5 vendido.
         q3 foi feito as 23h do dia 6 em Brasilia (02h do dia 7 em UTC). */
      const q1 = await criar(ana, 'Ana Souza', 1000, '2026-10-17', '2026-10-05T12:00:00Z')
      const q2 = await criar(
        bruno,
        'Bruno Lima',
        2000,
        '2026-10-08',
        '2026-10-06T12:00:00Z',
        'Rolo de la',
      )
      const q3 = await criar(ana, 'Ana Souza', 3000, '2026-10-09', '2026-10-07T02:00:00Z')
      const q4 = await criar(ana, 'Ana Souza', 4000, '2026-10-30', '2026-10-08T12:00:00Z')
      const q5 = await criar(ana, 'Ana Souza', 5000, '2026-10-30', '2026-10-08T13:00:00Z')
      await repo.close(loja, q4.id, { status: 'cancelled', saleId: null, closedAt: new Date() })
      const venda = randomUUID()
      await withTenant(
        sql,
        loja,
        (tx) => tx`
          INSERT INTO sales (id, company_id, number, status, gross_amount_cents, net_amount_cents,
                             created_at, created_by)
          VALUES (${venda}, ${loja}, 1, 'settled', 5000, 5000, now(), ${dono})
        `,
      )
      await repo.close(loja, q5.id, { status: 'converted', saleId: venda, closedAt: new Date() })
      Object.assign(ids, { q1, q2, q3, q4, q5 })
    }, 60_000)

    const filtro = (over: Partial<Parameters<typeof repo.list>[1]> = {}) => ({
      hoje: '2026-10-09',
      limite: 20,
      offset: 0,
      ...over,
    })

    const painelCheio = {
      open: { count: 2, totalCents: 4000 },
      expired: { count: 1, totalCents: 2000 },
      converted: { count: 1, totalCents: 5000 },
      cancelled: { count: 1, totalCents: 4000 },
    }

    it('painel por situacao; validade hoje ainda e aberto; mais novo primeiro', async () => {
      const r = await repo.list(loja, filtro())
      expect(r.resumo).toEqual(painelCheio)
      expect(r.total).toBe(5)
      expect(r.orcamentos.map((o) => o.id)).toEqual(
        [ids.q5, ids.q4, ids.q3, ids.q2, ids.q1].map((q) => q.id),
      )
      /* A pagina vem com os itens, como antes. */
      expect(r.orcamentos[0]?.items[0]?.description).toBe('Massa corrida')
      expect(r.orcamentos.find((o) => o.id === ids.q5.id)?.saleNumber).toBe(1)
    })

    it('a situacao recorta a lista e deixa o painel inteiro', async () => {
      const vencidos = await repo.list(loja, filtro({ situacao: 'expired' }))
      expect(vencidos.orcamentos.map((o) => o.id)).toEqual([ids.q2.id])
      expect(vencidos.total).toBe(1)
      expect(vencidos.resumo).toEqual(painelCheio)

      const abertos = await repo.list(loja, filtro({ situacao: 'open' }))
      expect(abertos.orcamentos.map((o) => o.id)).toEqual([ids.q3.id, ids.q1.id])
    })

    it('situacao sem nenhum: lista vazia, painel continua certo', async () => {
      const r = await repo.list(loja, filtro({ termo: 'ana', situacao: 'expired' }))
      expect(r.orcamentos).toEqual([])
      expect(r.total).toBe(0)
      expect(r.resumo).toEqual({
        open: { count: 2, totalCents: 4000 },
        expired: { count: 0, totalCents: 0 },
        converted: { count: 1, totalCents: 5000 },
        cancelled: { count: 1, totalCents: 4000 },
      })
    })

    it('pagina alem do fim: vazia, mas total e painel do filtro inteiro', async () => {
      const r = await repo.list(loja, filtro({ offset: 40 }))
      expect(r.orcamentos).toEqual([])
      expect(r.total).toBe(5)
      expect(r.resumo).toEqual(painelCheio)

      const segunda = await repo.list(loja, filtro({ limite: 2, offset: 2 }))
      expect(segunda.orcamentos.map((o) => o.id)).toEqual([ids.q3.id, ids.q2.id])
      expect(segunda.total).toBe(5)
    })

    it('busca por cliente (sem diferenciar maiuscula), numero e item', async () => {
      const bruno = await repo.list(loja, filtro({ termo: 'BRUNO' }))
      expect(bruno.orcamentos.map((o) => o.id)).toEqual([ids.q2.id])
      expect(bruno.resumo.expired).toEqual({ count: 1, totalCents: 2000 })
      expect(bruno.resumo.open).toEqual({ count: 0, totalCents: 0 })

      const numero = await repo.list(loja, filtro({ termo: String(ids.q3.number) }))
      expect(numero.orcamentos.map((o) => o.id)).toEqual([ids.q3.id])

      const item = await repo.list(loja, filtro({ termo: 'rolo' }))
      expect(item.orcamentos.map((o) => o.id)).toEqual([ids.q2.id])

      const nada = await repo.list(loja, filtro({ termo: 'zzz' }))
      expect(nada.total).toBe(0)
      expect(nada.resumo.open.count).toBe(0)
    })

    it('periodo pelo dia da loja: 23h do dia 6 em Brasilia e dia 6', async () => {
      const dia6 = await repo.list(loja, filtro({ from: '2026-10-06', to: '2026-10-06' }))
      expect(dia6.orcamentos.map((o) => o.id)).toEqual([ids.q3.id, ids.q2.id])
      expect(dia6.resumo.open).toEqual({ count: 1, totalCents: 3000 })

      const dePara = await repo.list(loja, filtro({ from: '2026-10-08' }))
      expect(dePara.total).toBe(2)
      const ate = await repo.list(loja, filtro({ to: '2026-10-05' }))
      expect(ate.orcamentos.map((o) => o.id)).toEqual([ids.q1.id])
    })

    it('outra loja nao enxerga nada', async () => {
      const r = await repo.list(empresa, filtro({ termo: 'Bruno' }))
      expect(r.orcamentos).toEqual([])
      expect(r.resumo.expired.count).toBe(0)
    })
  })
})
