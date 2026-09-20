import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * A auditoria aceita acao do sistema — NR-044, RNF-040.
 *
 * O tipo `Channel` em `core` tem quatro valores desde sempre; a coluna
 * aceitava dois. Enquanto nenhum job escrevia dado de negocio, ninguem via.
 * A baixa por webhook viu: 500 na rota, e o provedor reentregando para sempre.
 *
 * Este teste existe para o CHECK e o tipo nao divergirem de novo em silencio.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('auditoria de acao automatica — NR-044', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string

  /** O mesmo uuid de `ATOR_DO_SISTEMA`, em `core`. */
  const SISTEMA = '00000000-0000-4000-8000-000000000000'

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0026_auditoria_de_job')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresa = randomUUID()
    const cnpj = cnpjDeTeste('1')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, ${'Mercearia da Auditoria'}, ${cnpj},
                ${'contato@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  function registrar(canal: string, ator: string) {
    return withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO audit_logs
          (company_id, entity, entity_id, action, actor_id, channel, occurred_at)
        VALUES (${empresa}, ${'Receivable'}, ${randomUUID()}, ${'updated'},
                ${ator}, ${canal}, now())
      `,
    )
  }

  it('aceita os quatro canais que o tipo `Channel` tem', async () => {
    /* `job` e o que a baixa por webhook usa; `api` entrou junto para a mesma
       armadilha nao ficar armada para o proximo. */
    for (const canal of ['app', 'whatsapp', 'api', 'job']) {
      await expect(registrar(canal, SISTEMA)).resolves.toBeDefined()
    }
  })

  it('recusa canal que o tipo nao tem', async () => {
    /* O CHECK continua fechado: acrescentar os quatro nao virou aceitar
       qualquer texto. */
    await expect(registrar('inventado', SISTEMA)).rejects.toThrow()
  })

  it('o ator do sistema cabe, porque a coluna nao tem chave estrangeira', async () => {
    /* `actor_id` e uuid sem FK de proposito — o autor pode nao ser um usuario.
       Foi o que permitiu a auditoria dizer "sistema" em vez de mentir. */
    await expect(registrar('job', SISTEMA)).resolves.toBeDefined()
  })
})
