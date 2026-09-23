import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'
import { createWebhookInbox } from './webhook-inbox-repository.js'

/**
 * Caixa de entrada de webhooks — NR-063, RNF-028.
 *
 * Sem migration: `webhook_events` existe desde a `0007`.
 *
 * ## O que so a CI mostra
 *
 * A dedup depende de `INSERT ... ON CONFLICT DO NOTHING RETURNING id`, e num
 * `RETURNING` o Postgres aplica a politica de SELECT sobre a linha devolvida.
 * Como o `USING` desta tabela exige `app.company_id`, gravar SEM tenant faria
 * o retorno vir vazio mesmo numa insercao bem-sucedida — e vazio e exatamente
 * o que significa "ja existia". Todo aviso pareceria repetido, e nenhum seria
 * processado.
 *
 * Nenhum teste em memoria pega isso: e a politica de acesso do banco. Por isso
 * as asserções aqui rodam por um papel COMUM.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('caixa de entrada de webhooks — NR-063', () => {
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

    empresaA = await criarEmpresa(cnpjDeTeste('2'), 'Mercearia do Webhook')
    empresaB = await criarEmpresa(cnpjDeTeste('3'), 'Mercearia Vizinha')
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  const evento = (id: string, companyId: string) => ({
    provider: 'asaas',
    eventId: id,
    companyId,
    payload: { event: 'PAYMENT_CONFIRMED', id },
    receivedAt: new Date(),
  })

  it('o primeiro registro devolve novo — o RETURNING sobrevive a politica', async () => {
    const inbox = createWebhookInbox(sql)

    /* Se o `RETURNING` fosse filtrado pela politica, isto seria `processado` e
       nenhum aviso do sistema seria processado. */
    expect(await inbox.registrar(evento(`evt_${Date.now()}_a`, empresaA))).toBe('novo')
  })

  it('o mesmo aviso sem marcar processado devolve pendente', async () => {
    const inbox = createWebhookInbox(sql)
    const id = `evt_${Date.now()}_b`

    const primeira = await inbox.registrar(evento(id, empresaA))
    const segunda = await inbox.registrar(evento(id, empresaA))

    expect([primeira, segunda]).toEqual(['novo', 'pendente'])
  })

  it('o mesmo aviso depois de marcar processado devolve processado', async () => {
    const inbox = createWebhookInbox(sql)
    const id = `evt_${Date.now()}_b2`

    expect(await inbox.registrar(evento(id, empresaA))).toBe('novo')
    await inbox.marcarProcessado({
      provider: 'asaas',
      eventId: id,
      companyId: empresaA,
      processedAt: new Date(),
    })

    expect(await inbox.registrar(evento(id, empresaA))).toBe('processado')
  })

  it('avisos SIMULTANEOS: so um e novo', async () => {
    const inbox = createWebhookInbox(sql)
    const id = `evt_${Date.now()}_c`

    /* O provedor reentrega em paralelo quando a primeira resposta demora. Um
       SELECT antes do INSERT deixaria os dois serem `novo`. O perdedor do
       INSERT e `pendente` — processed_at ainda e nulo — e a rota reprocessa.
       E o trade-off aceito: duplicar o trabalho e melhor do que perder o
       aviso. */
    const [uma, outra] = await Promise.all([
      inbox.registrar(evento(id, empresaA)),
      inbox.registrar(evento(id, empresaA)),
    ])

    expect([uma, outra].filter((s) => s === 'novo')).toHaveLength(1)
    expect([uma, outra].every((s) => s === 'novo' || s === 'pendente')).toBe(true)
  })

  it('a unicidade e por PROVEDOR, e nao so por id', async () => {
    const inbox = createWebhookInbox(sql)
    const id = `evt_${Date.now()}_d`

    const asaas = await inbox.registrar(evento(id, empresaA))
    const outro = await inbox.registrar({ ...evento(id, empresaA), provider: 'outro' })

    /* Dois provedores podem numerar eventos do mesmo jeito; colidi-los faria
       um aviso legitimo ser descartado como repetido. */
    expect([asaas, outro]).toEqual(['novo', 'novo'])
  })

  it('marcar processado so alcanca a propria empresa', async () => {
    const inbox = createWebhookInbox(sql)
    const id = `evt_${Date.now()}_e`
    await inbox.registrar(evento(id, empresaA))

    /* O UPDATE roda sob o tenant da OUTRA empresa: a politica nao o deixa
       enxergar a linha, entao nada e marcado. */
    await inbox.marcarProcessado({
      provider: 'asaas',
      eventId: id,
      companyId: empresaB,
      processedAt: new Date(),
    })

    const [linha] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ processed_at: Date | null }[]>`
        SELECT processed_at FROM webhook_events
         WHERE provider = ${'asaas'} AND event_id = ${id}
      `,
    )
    expect(linha?.processed_at).toBeNull()
  })

  it('marcar processado grava quando e a propria empresa', async () => {
    const inbox = createWebhookInbox(sql)
    const id = `evt_${Date.now()}_f`
    await inbox.registrar(evento(id, empresaA))

    await inbox.marcarProcessado({
      provider: 'asaas',
      eventId: id,
      companyId: empresaA,
      processedAt: new Date(),
    })

    const [linha] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ processed_at: Date | null }[]>`
        SELECT processed_at FROM webhook_events
         WHERE provider = ${'asaas'} AND event_id = ${id}
      `,
    )
    /* A diferenca entre "recebido" e "processado" e o que permite reprocessar
       o que ficou pelo caminho sem reprocessar o que deu certo. */
    expect(linha?.processed_at).toBeInstanceOf(Date)
  })
})
