import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCustomerChargeRepository } from './customer-charge-repository.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Cobranca a distancia — NR-044, RF-068.
 *
 * O que se prova aqui e o caminho de VOLTA: dado um `external_reference`, dar
 * para chegar aos titulos que a cobranca cobriu. Sem isso, o cliente paga, o
 * aviso chega e nenhum recebivel baixa — silenciosamente.
 *
 * Como as outras suites de `db`: pulada sem `DATABASE_URL`, executada na CI, e
 * por um papel COMUM, sujeito a RLS.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('cobranca ao cliente — NR-044', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let clienteA: string
  let tituloUm: string
  let tituloDois: string

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${'contato@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
    return id
  }

  async function criarRecebivel(descricao: string, centavos: number): Promise<string> {
    const [linha] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO receivables
          (company_id, customer_id, origin, description, amount_cents,
           net_amount_cents, due_date)
        VALUES (${empresaA}, ${clienteA}, ${'manual'}, ${descricao}, ${centavos},
                ${centavos}, ${'2026-09-01'})
        RETURNING id
      `,
    )
    return linha!.id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0025_cobranca_ao_cliente')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('4'), 'Mercearia que Cobra')
    empresaB = await criarEmpresa(cnpjDeTeste('5'), 'Mercearia Vizinha')

    const [cliente] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO customers (company_id, name) VALUES (${empresaA}, ${'Dona Marta'})
        RETURNING id
      `,
    )
    clienteA = cliente!.id

    tituloUm = await criarRecebivel('Fiado de agosto', 5_000)
    tituloDois = await criarRecebivel('Fiado de setembro', 3_000)
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  const pedido = (referencia: string) => ({
    companyId: empresaA,
    customerId: clienteA,
    externalReference: referencia,
    amountCents: 8_000,
    providerLinkId: 'link_1',
    checkoutUrl: 'https://www.asaas.com/c/link_1',
    titulos: [
      { receivableId: tituloUm, amountCents: 5_000 },
      { receivableId: tituloDois, amountCents: 3_000 },
    ],
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
  })

  /** O caminho de volta, como o webhook vai percorrer. */
  function titulosDaCobranca(companyId: string, referencia: string) {
    return withTenant(
      sql,
      companyId,
      (tx) => tx<{ receivable_id: string; amount_cents: string }[]>`
        SELECT r.receivable_id, r.amount_cents
          FROM customer_charges c
          JOIN customer_charge_receivables r ON r.charge_id = c.id
         WHERE c.external_reference = ${referencia}
           AND c.deleted_at IS NULL
         ORDER BY r.amount_cents DESC
      `,
    )
  }

  it('do external_reference chega-se aos titulos cobertos', async () => {
    const referencia = `req-${Date.now()}-a`
    await createCustomerChargeRepository(sql).registrar(pedido(referencia))

    const titulos = await titulosDaCobranca(empresaA, referencia)

    /* Este e o defeito que a tabela conserta: antes, o `external_reference`
       nao levava a lugar nenhum. */
    expect(titulos.map((t) => t.receivable_id)).toEqual([tituloUm, tituloDois])
    expect(titulos.map((t) => Number(t.amount_cents))).toEqual([5_000, 3_000])
  })

  it('registrar o mesmo pedido de novo nao duplica a cobranca', async () => {
    const referencia = `req-${Date.now()}-b`
    const repo = createCustomerChargeRepository(sql)

    await repo.registrar(pedido(referencia))
    await repo.registrar(pedido(referencia))

    const [contagem] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ total: string }[]>`
        SELECT count(*) AS total FROM customer_charges
         WHERE external_reference = ${referencia} AND deleted_at IS NULL
      `,
    )
    /* Duas cobrancas para um link so fariam a baixa acontecer duas vezes para
       um pagamento so. */
    expect(Number(contagem?.total ?? 0)).toBe(1)
    expect(await titulosDaCobranca(empresaA, referencia)).toHaveLength(2)
  })

  it('a cobranca nasce pendente — link gerado nao e link pago', async () => {
    const referencia = `req-${Date.now()}-c`
    await createCustomerChargeRepository(sql).registrar(pedido(referencia))

    const [linha] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ status: string; paid_at: Date | null }[]>`
        SELECT status, paid_at FROM customer_charges
         WHERE external_reference = ${referencia}
      `,
    )
    expect([linha?.status, linha?.paid_at]).toEqual(['pending', null])
  })

  it('a cobranca de uma empresa nao aparece para outra', async () => {
    const referencia = `req-${Date.now()}-d`
    await createCustomerChargeRepository(sql).registrar(pedido(referencia))

    /* O webhook filtra por empresa antes de qualquer coisa; uma confusao aqui
       baixaria titulo da loja errada. */
    expect(await titulosDaCobranca(empresaB, referencia)).toHaveLength(0)
  })

  it('cobranca de valor zero e recusada pelo banco', async () => {
    const referencia = `req-${Date.now()}-e`

    /* `CHECK (amount_cents > 0)`: cobranca de zero nao existe, e um link de
       zero e um link que o cliente paga sem pagar nada. */
    await expect(
      createCustomerChargeRepository(sql).registrar({
        ...pedido(referencia),
        amountCents: 0,
      }),
    ).rejects.toThrow()
  })
})
