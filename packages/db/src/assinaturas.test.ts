import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createSubscriptionRepository } from './subscription-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Assinatura no banco — NR-063, RF-110 a RF-118.
 *
 * Sem migration nova: a tabela existe desde a `0007`. O que se prova aqui e o
 * que o SQL pode errar, e nao o que a maquina de estados ja garante em
 * `core/subscriptions/estado.test.ts`:
 *
 *   - o upsert e idempotente DE VERDADE, sob concorrencia;
 *   - voltar de `restricted` para `active` LIMPA a marca do bloqueio;
 *   - a assinatura de uma empresa nao vaza para outra.
 *
 * Como as outras suites de `db`: pulada sem `DATABASE_URL`, executada na CI, e
 * com as asserções por um papel COMUM — com a conexao de administrador,
 * superusuario ignora RLS e a suite mediria o vazio.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('assinatura — NR-063', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string

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

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0007_acrescimos')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    /* Prefixos 7 e 8: os menores ja sao de outras suites, e duas podem cair no
       mesmo milissegundo. */
    empresaA = await criarEmpresa(cnpjDeTeste('7'), 'Mercearia A')
    empresaB = await criarEmpresa(cnpjDeTeste('8'), 'Mercearia B')
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  const repo = () => createSubscriptionRepository(sql)
  const EM = new Date('2026-09-19T14:30:00.000Z')
  const FIM = new Date('2026-10-03T23:59:59.999Z')

  it('cria em trial e devolve a assinatura ja no vocabulario do contrato', async () => {
    const a = await repo().startTrial({
      companyId: empresaA,
      planCode: 'essencial',
      trialEndsAt: FIM,
      createdAt: EM,
    })

    expect(a.companyId).toBe(empresaA)
    expect(a.status).toBe('trial')
    /* `timestamptz` volta como Date do driver; o contrato pede texto ISO, e a
       conversao e da borda. */
    expect(a.trialEndsAt).toBe(FIM.toISOString())
    expect(a.nextDueDate).toBeNull()
  })

  it('duas chamadas SIMULTANEAS devolvem a mesma assinatura', async () => {
    const empresa = await criarEmpresa(cnpjDeTeste('9'), 'Mercearia C')
    const pedido = {
      companyId: empresa,
      planCode: 'essencial',
      trialEndsAt: FIM,
      createdAt: EM,
    }

    /*
     * O ponto do teste e a concorrencia, e nao a repeticao: um `SELECT` antes
     * do `INSERT` passaria no sequencial e falharia aqui, porque as duas
     * requisicoes veriam "nao existe" e tentariam inserir. Quem decide e a
     * `UNIQUE (company_id)`.
     */
    const [uma, outra] = await Promise.all([
      repo().startTrial(pedido),
      repo().startTrial({ ...pedido, trialEndsAt: new Date('2027-01-01T00:00:00.000Z') }),
    ])

    expect(uma!.trialEndsAt).toBe(outra!.trialEndsAt)
    /* A segunda nao pode ter estendido o prazo: seria teste infinito de graca,
       a um POST repetido de distancia. */
    expect(uma!.trialEndsAt).toBe(FIM.toISOString())
  })

  it('voltar de restrita para ativa limpa a marca do bloqueio — RF-118', async () => {
    const empresa = await criarEmpresa(cnpjDeTeste('a'), 'Mercearia D')
    await repo().startTrial({
      companyId: empresa,
      planCode: 'essencial',
      trialEndsAt: FIM,
      createdAt: EM,
    })

    await repo().updateStatus({
      companyId: empresa,
      status: 'restricted',
      restrictedAt: new Date('2026-10-04T00:00:00.000Z'),
      cancelledAt: null,
      updatedAt: EM,
    })
    expect((await repo().findByCompany(empresa))?.restrictedAt).not.toBeNull()

    await repo().updateStatus({
      companyId: empresa,
      status: 'active',
      restrictedAt: null,
      cancelledAt: null,
      updatedAt: EM,
    })

    const depois = await repo().findByCompany(empresa)
    expect(depois?.status).toBe('active')
    /* Sem isto a tela continuaria dizendo desde quando a loja esta bloqueada,
       para uma loja que acabou de pagar. */
    expect(depois?.restrictedAt).toBeNull()
  })

  it('a assinatura de uma empresa nao aparece para outra', async () => {
    await repo().startTrial({
      companyId: empresaA,
      planCode: 'essencial',
      trialEndsAt: FIM,
      createdAt: EM,
    })

    /* RLS por `app.company_id`: o bloqueio de uma loja nunca pode atravessar
       para outra. */
    expect(await repo().findByCompany(empresaB)).toBeUndefined()
  })
})
