import { randomBytes, randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createPaymentCredentials } from './payment-credentials-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Cofre da conta de recebimento — NR-044, RNF-022.
 *
 * A cifragem tem teste proprio, sem banco. O que se prova AQUI e o que so o
 * banco prova: que a chave chega CIFRADA na coluna, e que a chave de uma loja
 * nao vaza para outra — o isolamento e o ponto inteiro de haver uma subconta
 * por lojista.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('cofre de pagamento — NR-044', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let usuario: string

  const CHAVE = randomBytes(32)
  let repo: ReturnType<typeof createPaymentCredentials>

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`c@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0023_cofre_de_pagamento')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('6'), 'Loja Pagamento A')
    empresaB = await criarEmpresa(cnpjDeTeste('7'), 'Loja Pagamento B')

    usuario = randomUUID()
    await withTenant(
      sql,
      empresaA,
      (tx) => tx`
        INSERT INTO users (id, name, email) VALUES (${usuario}, 'Dono', ${`p${usuario}@local`})
      `,
    )

    repo = createPaymentCredentials(sql, CHAVE)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  it('loja sem conta responde undefined, e nao erro', async () => {
    expect(await repo.apiKeyDaEmpresa(empresaB)).toBeUndefined()
    expect(await repo.temConta(empresaB)).toBe(false)
  })

  it('grava cifrado e devolve em claro para a dona', async () => {
    await repo.salvar({
      companyId: empresaA,
      apiKey: '$aact_chave_da_loja',
      atualizadoPor: usuario,
    })

    expect(await repo.apiKeyDaEmpresa(empresaA)).toBe('$aact_chave_da_loja')
    expect(await repo.temConta(empresaA)).toBe(true)
  })

  /* O que a coluna guarda nao pode ser a chave legivel: quem abrir um dump
     nao leva a conta de recebimento do lojista junto. */
  it('a coluna nao guarda a chave em texto puro', async () => {
    await repo.salvar({ companyId: empresaA, apiKey: '$aact_outra', atualizadoPor: usuario })

    const [linha] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ api_key: string }[]>`
        SELECT api_key FROM company_payment_credentials WHERE company_id = ${empresaA}
      `,
    )

    expect(linha?.api_key).toBeDefined()
    expect(linha!.api_key).not.toContain('$aact_outra')
  })

  it('salvar de novo substitui, sem criar segunda linha', async () => {
    await repo.salvar({ companyId: empresaA, apiKey: '$aact_terceira', atualizadoPor: usuario })

    const linhas = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ n: string }[]>`
        SELECT count(*)::text AS n FROM company_payment_credentials WHERE company_id = ${empresaA}
      `,
    )

    expect(linhas[0]?.n).toBe('1')
    expect(await repo.apiKeyDaEmpresa(empresaA)).toBe('$aact_terceira')
  })

  /* Uma subconta por lojista e a razao de o dinheiro cair na conta certa. Se a
     chave da A aparecesse para a B, a cobranca da B iria para a conta da A. */
  it('a chave de uma loja nao aparece para outra', async () => {
    expect(await repo.apiKeyDaEmpresa(empresaB)).toBeUndefined()
  })
})
