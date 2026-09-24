import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCouponRepository } from './coupon-repository.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withPlatformScope, withTenant } from './tenant.js'

/**
 * Cupons pelo caminho publico — NR-063, RF-114, RF-115.
 *
 * ## Por que esta suite existe do jeito que existe
 *
 * A primeira versao lia `SELECT ... FROM coupons` direto e morreu na CI com
 * `new row violates row-level security policy`. A tabela tem RLS FORCADA **sem
 * politica permissiva** (migration 0014): pelo papel da aplicacao nao ha
 * SELECT nem INSERT. O unico caminho e `coupon_lookup`, e o teste prova isso
 * explicitamente — para que a proxima pessoa que pensar em ler a tabela
 * encontre a resposta aqui em vez de na CI.
 *
 * Como as outras suites de `db`: pulada sem `DATABASE_URL`, executada na CI.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('cupons — NR-063', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let codigoDoLojista: string

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0024_motivo_do_cupom')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    /*
     * A empresa nasce sob `withTenant` com o id ja escolhido: a politica de
     * `companies` e `id = current_company_id()`, entao um INSERT sem tenant no
     * contexto morre em `current_company_id()` antes de chegar na politica.
     */
    const cnpj = cnpjDeTeste('6')
    const empresa = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, ${'Mercearia do Cupom'}, ${cnpj},
                ${'contato@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )

    /* O cupom, pela funcao da 0014 — nao ha INSERT possivel em `coupons`. */
    codigoDoLojista = `IND${Date.now()}`
    await withPlatformScope(
      sql,
      (tx) => tx`SELECT * FROM coupon_create_for_company(${empresa}, ${codigoDoLojista})`,
    )
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  it('a tabela `coupons` e mesmo inacessivel pelo papel da aplicacao', async () => {
    /*
     * A afirmacao que faltava no PR anterior. Se um dia alguem acrescentar uma
     * politica permissiva a `coupons`, este teste cai — e ai a conversa e
     * sobre a decisao, nao sobre um repositorio que parou de funcionar.
     */
    const linhas = await withPlatformScope(
      sql,
      (tx) => tx<{ id: string }[]>`SELECT id FROM coupons`,
    )
    expect(linhas).toHaveLength(0)
  })

  it('o cupom do lojista nasce ativo e valendo — ADR-0013', async () => {
    const c = await createCouponRepository(sql).lookup(codigoDoLojista)

    expect(c?.kind).toBe('lojista')
    /* Cupom de lojista nao passa por aprovacao; o de parceiro nasce inativo. */
    expect([c?.active, c?.reason]).toEqual([true, 'ok'])
  })

  it('o percentual volta NUMERO, e nao a string do numeric', async () => {
    const c = await createCouponRepository(sql).lookup(codigoDoLojista)

    /* Sem a conversao na borda, `Money.percentage("30")` receberia texto. */
    expect(typeof c?.discountPercent).toBe('number')
    expect(c?.discountPercent).toBeGreaterThan(0)
  })

  it('a consulta nao devolve caixa alta nem baixa — compara sem caixa', async () => {
    const c = await createCouponRepository(sql).lookup(codigoDoLojista.toLowerCase())

    /* `upper(c.code) = upper(p_code)` na funcao. Quem digita no celular quase
       sempre manda minuscula. */
    expect(c?.couponId).toBeDefined()
  })

  it('codigo que nao existe devolve undefined', async () => {
    expect(await createCouponRepository(sql).lookup('NAOEXISTE')).toBeUndefined()
  })

  it('o retorno nunca traz PIX nem a mensagem da candidatura', async () => {
    const [linha] = await withPlatformScope(
      sql,
      (tx) => tx<Record<string, unknown>[]>`SELECT * FROM coupon_lookup(${codigoDoLojista})`,
    )

    /* A consulta e publica por codigo: quem adivinhar um codigo nao pode levar
       junto a chave PIX de quem o emitiu. */
    expect(Object.keys(linha ?? {}).sort()).toEqual(
      ['active', 'coupon_id', 'discount_percent', 'kind', 'reason', 'referrer_label'].sort(),
    )
  })

  it('o resgate grava o vinculo pelo papel da aplicacao, e so uma vez por empresa', async () => {
    const cnpj = cnpjDeTeste('7')
    const indicada = randomUUID()
    await withTenant(
      sql,
      indicada,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${indicada}, ${'Loja Indicada'}, ${cnpj},
                ${'contato@' + cnpj + '.local'}, ${'41999990001'})
      `,
    )
    const cupons = createCouponRepository(sql)

    /* Pelo cadastro — RF-114. A funcao e SECURITY DEFINER: `coupon_redemptions`
       tambem nao aceita INSERT direto do papel da aplicacao. */
    await expect(cupons.recordRedemption(codigoDoLojista, indicada)).resolves.toBeUndefined()
    await expect(cupons.recordRedemption(codigoDoLojista, indicada)).rejects.toThrow(/ja resgatou/)
  })
})
