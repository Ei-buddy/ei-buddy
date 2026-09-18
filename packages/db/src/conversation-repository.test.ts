import { randomUUID } from 'node:crypto'
import { RETENCAO_MENSAGENS_MS } from '@na-regua/core'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createConversationPurgeRepository,
  createConversationStore,
} from './conversation-repository.js'
import { listCompanyIds } from './list-company-ids.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withPlatformScope, withTenant } from './tenant.js'

/**
 * Store Postgres do historico — NR-062 US2.
 *
 * T023: isolamento ja vem da 0007, nao desta fatia:
 *   SELECT enable_tenant_isolation('conversations');
 *   SELECT enable_tenant_isolation('messages');
 * Os testes abaixo usam conectarComoAplicacao (papel comum, sem
 * superusuario e sem BYPASSRLS). Nao desligar RLS.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

const agora = new Date('2026-09-17T18:00:00.000Z')

describe.skipIf(!DATABASE_URL)('store Postgres de conversa — NR-062 US2', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let store: ReturnType<typeof createConversationStore>
  let purge: ReturnType<typeof createConversationPurgeRepository>

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) =>
        tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${'contato@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
    return id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0019_conversation_messages_idx')
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0020_list_company_ids')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    /* Prefixos 7 e 8: nao colidem com 1–6 das outras suites no mesmo ms. */
    empresaA = await criarEmpresa(cnpjDeTeste('7'), 'Barbearia Conversa A')
    empresaB = await criarEmpresa(cnpjDeTeste('8'), 'Barbearia Conversa B')
    store = createConversationStore(sql)
    purge = createConversationPurgeRepository(sql)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    const empresas = [empresaA, empresaB].filter(Boolean)
    for (const empresa of empresas) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM sales`
        await tx`DELETE FROM company_counters`
        await tx`DELETE FROM messages`
        await tx`DELETE FROM conversations`
        await tx`DELETE FROM companies`
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  }, 60_000)

  function chaveApp(empresa: string, userId = `u-${randomUUID()}`): string {
    return `app:${empresa}:${userId}`
  }

  function chaveWa(
    empresa: string,
    peer = `55${randomUUID().replaceAll('-', '').slice(0, 11)}`,
  ): string {
    return `wa:${empresa}:${peer}`
  }

  describe('isolamento por empresa — T018', () => {
    it('loadActive da loja B na chave da A devolve undefined', async () => {
      const userId = `iso-${randomUUID()}`
      const chaveDaA = chaveApp(empresaA, userId)

      await store.append(empresaA, {
        conversationKey: chaveDaA,
        userBody: 'cobra o Joao da loja A',
        assistantBody: 'Enviar cobranca para cli-da-A. Confirma?',
        toolCalls: { customerId: 'cli-da-A' },
        at: agora,
      })

      const daB = await store.loadActive(empresaB, chaveDaA, agora)
      expect(daB).toBeUndefined()

      const daA = await store.loadActive(empresaA, chaveDaA, agora)
      expect(daA).toBeDefined()
      expect(daA?.idle).toBe(false)
      expect(daA?.messages.map((m) => m.body)).toEqual([
        'cobra o Joao da loja A',
        'Enviar cobranca para cli-da-A. Confirma?',
      ])
    })

    it('append da B na chave da A nao insere messages com company_id da A', async () => {
      const userId = `cruz-${randomUUID()}`
      const chaveDaA = chaveApp(empresaA, userId)

      await store.append(empresaA, {
        conversationKey: chaveDaA,
        userBody: 'corpo so da A',
        assistantBody: 'resposta so da A',
        at: agora,
      })

      const antes = await store.loadActive(empresaA, chaveDaA, agora)
      expect(antes?.messages.map((m) => m.body)).toEqual(['corpo so da A', 'resposta so da A'])

      await store.append(empresaB, {
        conversationKey: chaveDaA,
        userBody: 'tentativa da B no fio da A',
        assistantBody: 'B nao herda o Joao',
        at: agora,
      })

      const depoisA = await store.loadActive(empresaA, chaveDaA, agora)
      expect(depoisA?.messages.map((m) => m.body)).toEqual(['corpo so da A', 'resposta so da A'])
      expect(depoisA?.messages.some((m) => m.body.includes('tentativa da B'))).toBe(false)

      const daB = await store.loadActive(empresaB, chaveDaA, agora)
      expect(daB?.messages.map((m) => m.body)).toEqual([
        'tentativa da B no fio da A',
        'B nao herda o Joao',
      ])

      const mensagensDaA = await withTenant(
        sql,
        empresaA,
        (tx) =>
          tx<{ body: string; company_id: string }[]>`
            SELECT body, company_id::text FROM messages
            WHERE deleted_at IS NULL
            ORDER BY created_at, ctid
          `,
      )
      expect(mensagensDaA.every((m) => m.company_id === empresaA)).toBe(true)
      expect(mensagensDaA.map((m) => m.body)).not.toContain('tentativa da B no fio da A')
    })
  })

  describe('reinicio — T041 (US6)', () => {
    it('segunda instancia do store ainda le o fio ativo via Postgres', async () => {
      const chave = chaveApp(empresaA)
      const at = agora

      const store1 = createConversationStore(sql)
      await store1.append(empresaA, {
        conversationKey: chave,
        userBody: 'cobra o Joao',
        assistantBody: 'Enviar cobranca para cli-1. Confirma?',
        toolCalls: { customerId: 'cli-1' },
        at,
      })
      const daPrimeira = await store1.loadActive(empresaA, chave, at)
      expect(daPrimeira).toBeDefined()
      if (daPrimeira === undefined) return
      const conversationId = daPrimeira.conversationId
      const corpos = daPrimeira.messages.map((m) => m.body)
      expect(corpos).toEqual(['cobra o Joao', 'Enviar cobranca para cli-1. Confirma?'])

      /* A primeira instancia some; a leitura seguinte nao e memoria local. */
      const store2 = createConversationStore(sql)
      expect(store2).not.toBe(store1)

      const daSegunda = await store2.loadActive(empresaA, chave, at)
      expect(daSegunda?.conversationId).toBe(conversationId)
      expect(daSegunda?.idle).toBe(false)
      expect(daSegunda?.messages.map((m) => m.body)).toEqual(corpos)

      const noPostgres = await withTenant(
        sql,
        empresaA,
        (tx) =>
          tx<{ body: string }[]>`
            SELECT body FROM messages
            WHERE conversation_id = ${conversationId}::uuid
              AND deleted_at IS NULL
            ORDER BY created_at, ctid
          `,
      )
      expect(noPostgres.map((m) => m.body)).toEqual(corpos)
    })
  })

  describe('canais distintos — T020', () => {
    it('app:{id}:{userId} e wa:{id}:{peer} sao fios distintos', async () => {
      const userId = `http-${randomUUID()}`
      const peer = `5511${randomUUID().replaceAll('-', '').slice(0, 8)}`
      const chaveAppA = chaveApp(empresaA, userId)
      const chaveWaA = chaveWa(empresaA, peer)

      await store.append(empresaA, {
        conversationKey: chaveAppA,
        userBody: 'mensagem do harness HTTP',
        assistantBody: 'ok app',
        at: agora,
      })
      await store.append(empresaA, {
        conversationKey: chaveWaA,
        userBody: 'mensagem do Studio',
        assistantBody: 'ok wa',
        at: agora,
      })

      const app = await store.loadActive(empresaA, chaveAppA, agora)
      const wa = await store.loadActive(empresaA, chaveWaA, agora)

      expect(app?.conversationId).not.toBe(wa?.conversationId)
      expect(app?.messages.map((m) => m.body)).toEqual(['mensagem do harness HTTP', 'ok app'])
      expect(wa?.messages.map((m) => m.body)).toEqual(['mensagem do Studio', 'ok wa'])
      expect(app?.messages.some((m) => m.body.includes('Studio'))).toBe(false)
      expect(wa?.messages.some((m) => m.body.includes('HTTP'))).toBe(false)
    })
  })

  describe('relogio injetado', () => {
    it('created_at das messages e turn.at, nao now() do banco', async () => {
      const chave = chaveApp(empresaA)
      const at = new Date('2020-03-04T11:22:33.000Z')

      await store.append(empresaA, {
        conversationKey: chave,
        userBody: 'turno antigo',
        assistantBody: 'resposta antiga',
        at,
      })

      const ativo = await store.loadActive(empresaA, chave, at)
      expect(ativo?.messages).toHaveLength(2)
      expect(ativo?.messages[0]?.createdAt.toISOString()).toBe(at.toISOString())
      expect(ativo?.messages[1]?.createdAt.toISOString()).toBe(at.toISOString())
    })
  })

  describe('idle 2 h — T025 (US3)', () => {
    it('loadActive alem de 2 h devolve idle e nao apaga as messages', async () => {
      const chave = chaveApp(empresaA)
      const at = new Date('2026-09-17T12:00:00.000Z')

      await store.append(empresaA, {
        conversationKey: chave,
        userBody: 'cobra o Joao',
        assistantBody: 'Enviar cobranca para cli-1. Confirma?',
        toolCalls: { customerId: 'cli-1' },
        at,
      })

      const ativo = await store.loadActive(empresaA, chave, at)
      expect(ativo?.idle).toBe(false)
      expect(ativo?.messages).toHaveLength(2)

      const depoisIdle = new Date(at.getTime() + 2 * 60 * 60 * 1000 + 1)
      const ocioso = await store.loadActive(empresaA, chave, depoisIdle)
      expect(ocioso?.idle).toBe(true)
      expect(ocioso?.messages).toEqual([])

      const linhas = await withTenant(
        sql,
        empresaA,
        (tx) =>
          tx<{ body: string; deleted_at: Date | null }[]>`
            SELECT body, deleted_at FROM messages
            WHERE conversation_id = ${ocioso!.conversationId}::uuid
            ORDER BY created_at, ctid
          `,
      )
      expect(linhas).toHaveLength(2)
      expect(linhas.map((m) => m.body)).toEqual([
        'cobra o Joao',
        'Enviar cobranca para cli-1. Confirma?',
      ])
      expect(linhas.every((m) => m.deleted_at === null)).toBe(true)
    })
  })

  describe('janela 12 — T030 (US4)', () => {
    it('INSERT 13 vigentes: loadActive devolve 12 e o corpo antigo permanece na tabela', async () => {
      const chave = chaveApp(empresaA)
      const t0 = agora.getTime()

      await store.append(empresaA, {
        conversationKey: chave,
        userBody: 'seed',
        assistantBody: 'seed',
        at: agora,
      })
      const seed = await store.loadActive(empresaA, chave, agora)
      expect(seed).toBeDefined()
      if (seed === undefined) return
      const conversationId = seed.conversationId

      await withTenant(sql, empresaA, async (tx) => {
        await tx`DELETE FROM messages WHERE conversation_id = ${conversationId}::uuid`
        for (let i = 1; i <= 13; i++) {
          const role = i % 2 === 1 ? 'user' : 'assistant'
          const body = `msg-${String(i).padStart(2, '0')}`
          const at = new Date(t0 + i * 1_000)
          await tx`
            INSERT INTO messages (company_id, conversation_id, role, body, created_at)
            VALUES (${empresaA}::uuid, ${conversationId}::uuid, ${role}, ${body}, ${at})
          `
        }
      })

      const agoraJanela = new Date(t0 + 13_000)
      const ativo = await store.loadActive(empresaA, chave, agoraJanela)
      expect(ativo?.idle).toBe(false)
      expect(ativo?.messages).toHaveLength(12)
      expect(ativo?.messages.map((m) => m.body)).toEqual([
        'msg-02',
        'msg-03',
        'msg-04',
        'msg-05',
        'msg-06',
        'msg-07',
        'msg-08',
        'msg-09',
        'msg-10',
        'msg-11',
        'msg-12',
        'msg-13',
      ])
      expect(ativo?.messages.some((m) => m.body === 'msg-01')).toBe(false)

      const naTabela = await withTenant(
        sql,
        empresaA,
        (tx) =>
          tx<{ body: string; deleted_at: Date | null }[]>`
            SELECT body, deleted_at FROM messages
            WHERE conversation_id = ${conversationId}::uuid
            ORDER BY created_at, ctid
          `,
      )
      expect(naTabela).toHaveLength(13)
      expect(naTabela[0]?.body).toBe('msg-01')
      expect(naTabela.map((m) => m.body)).toContain('msg-01')
      expect(naTabela.every((m) => m.deleted_at === null)).toBe(true)
    })
  })

  describe('expurgo 30 d — T034 T035 T036 (US5)', () => {
    const trintaEUmDiasMs = 31 * 24 * 60 * 60 * 1000
    const ontemMs = 24 * 60 * 60 * 1000

    async function corpoDasMensagens(empresa: string, conversationId: string) {
      return withTenant(
        sql,
        empresa,
        (tx) =>
          tx<{ body: string }[]>`
            SELECT body FROM messages
            WHERE conversation_id = ${conversationId}::uuid
            ORDER BY created_at, ctid
          `,
      )
    }

    it('T034: mensagens de 31 dias somem; a de ontem fica; orfa ganha deleted_at', async () => {
      const userOrfa = `purge-orfa-${randomUUID()}`
      const userMista = `purge-mista-${randomUUID()}`
      const chaveOrfa = chaveApp(empresaA, userOrfa)
      const chaveMista = chaveApp(empresaA, userMista)
      const ha31Dias = new Date(agora.getTime() - trintaEUmDiasMs)
      const ontem = new Date(agora.getTime() - ontemMs)

      await store.append(empresaA, {
        conversationKey: chaveOrfa,
        userBody: 'texto velho da orfa',
        assistantBody: 'resposta velha da orfa',
        at: ha31Dias,
      })
      await store.append(empresaA, {
        conversationKey: chaveMista,
        userBody: 'texto velho da mista',
        assistantBody: 'resposta velha da mista',
        at: ha31Dias,
      })
      await store.append(empresaA, {
        conversationKey: chaveMista,
        userBody: 'texto de ontem',
        assistantBody: 'resposta de ontem',
        at: ontem,
      })

      const orfaAntes = await store.loadActive(empresaA, chaveOrfa, ha31Dias)
      const mistaAntes = await store.loadActive(empresaA, chaveMista, ontem)
      expect(orfaAntes).toBeDefined()
      expect(mistaAntes).toBeDefined()
      if (orfaAntes === undefined || mistaAntes === undefined) return
      const idOrfa = orfaAntes.conversationId
      const idMista = mistaAntes.conversationId

      const apagadas = await purge.deleteMessagesOlderThan(empresaA, agora, RETENCAO_MENSAGENS_MS)
      expect(apagadas).toBeGreaterThanOrEqual(4)

      expect(await corpoDasMensagens(empresaA, idOrfa)).toEqual([])
      const mistaDepois = await corpoDasMensagens(empresaA, idMista)
      expect(mistaDepois.map((m) => m.body)).toEqual(['texto de ontem', 'resposta de ontem'])
      expect(mistaDepois.map((m) => m.body)).not.toContain('texto velho da mista')

      const fechadas = await purge.closeConversationsWithoutMessages(empresaA, agora)
      expect(fechadas).toBeGreaterThanOrEqual(1)

      const [orfaRow] = await withTenant(
        sql,
        empresaA,
        (tx) =>
          tx<{ id: string; deleted_at: Date | null }[]>`
            SELECT id, deleted_at FROM conversations WHERE id = ${idOrfa}::uuid
          `,
      )
      expect(orfaRow).toBeDefined()
      expect(orfaRow?.deleted_at).not.toBeNull()
      expect(orfaRow?.deleted_at?.toISOString()).toBe(agora.toISOString())

      const [mistaRow] = await withTenant(
        sql,
        empresaA,
        (tx) =>
          tx<{ deleted_at: Date | null }[]>`
            SELECT deleted_at FROM conversations WHERE id = ${idMista}::uuid
          `,
      )
      expect(mistaRow?.deleted_at).toBeNull()

      await store.append(empresaA, {
        conversationKey: chaveOrfa,
        userBody: 'recomeco apos expurgo',
        assistantBody: 'nova conversa da mesma identidade',
        at: agora,
      })
      const nova = await store.loadActive(empresaA, chaveOrfa, agora)
      expect(nova?.conversationId).toBeDefined()
      expect(nova?.conversationId).not.toBe(idOrfa)
    })

    it('T035: venda criada antes do expurgo continua existindo', async () => {
      const chave = chaveApp(empresaA)
      const ha31Dias = new Date(agora.getTime() - trintaEUmDiasMs)
      await store.append(empresaA, {
        conversationKey: chave,
        userBody: 'fecha a venda do cafe',
        assistantBody: 'venda registrada',
        at: ha31Dias,
      })

      const vendaId = randomUUID()
      await withTenant(sql, empresaA, async (tx) => {
        const [contador] = await tx<{ next_counter: string }[]>`
          SELECT next_counter('sale')
        `
        await tx`
          INSERT INTO sales (id, company_id, number, gross_amount_cents, net_amount_cents)
          VALUES (
            ${vendaId}::uuid,
            ${empresaA}::uuid,
            ${contador!.next_counter},
            1990,
            1990
          )
        `
      })

      await purge.deleteMessagesOlderThan(empresaA, agora, RETENCAO_MENSAGENS_MS)
      await purge.closeConversationsWithoutMessages(empresaA, agora)

      const [venda] = await withTenant(
        sql,
        empresaA,
        (tx) => tx<{ id: string }[]>`SELECT id FROM sales WHERE id = ${vendaId}::uuid`,
      )
      expect(venda?.id).toBe(vendaId)

      await withTenant(sql, empresaA, async (tx) => {
        await tx`DELETE FROM sales WHERE id = ${vendaId}::uuid`
        await tx`DELETE FROM company_counters`
      })
    })

    it('T036: expurgo da loja A nao apaga mensagens da loja B', async () => {
      const userB = `purge-b-${randomUUID()}`
      const chaveB = chaveApp(empresaB, userB)
      const ha31Dias = new Date(agora.getTime() - trintaEUmDiasMs)

      await store.append(empresaB, {
        conversationKey: chaveB,
        userBody: 'corpo so da loja B',
        assistantBody: 'resposta so da loja B',
        at: ha31Dias,
      })
      const daB = await store.loadActive(empresaB, chaveB, ha31Dias)
      expect(daB).toBeDefined()
      if (daB === undefined) return

      const apagadasNaA = await purge.deleteMessagesOlderThan(
        empresaA,
        agora,
        RETENCAO_MENSAGENS_MS,
      )
      expect(apagadasNaA).toBeGreaterThanOrEqual(0)

      const corposB = await corpoDasMensagens(empresaB, daB.conversationId)
      expect(corposB.map((m) => m.body)).toEqual(['corpo so da loja B', 'resposta so da loja B'])

      await purge.closeConversationsWithoutMessages(empresaA, agora)

      const [conversaB] = await withTenant(
        sql,
        empresaB,
        (tx) =>
          tx<{ deleted_at: Date | null }[]>`
            SELECT deleted_at FROM conversations WHERE id = ${daB.conversationId}::uuid
          `,
      )
      expect(conversaB?.deleted_at).toBeNull()
    })
  })

  describe('listagem de tenants para expurgo — T056', () => {
    it('SELECT cru em companies no papel da aplicacao ainda lanca', async () => {
      /* A guarda: se isto deixar de lancar, o job voltaria a "funcionar" pelo
         motivo errado — papel que ignora RLS — e o SECURITY DEFINER viraria
         enfeite. Mesma prova de cadastro-de-conta.test.ts. */
      await expect(withPlatformScope(sql, (tx) => tx`SELECT id FROM companies`)).rejects.toThrow(
        /app\.company_id/,
      )
    })

    it('listCompanyIds devolve as empresas A e B sem tenant no contexto', async () => {
      const ids = await listCompanyIds(sql)
      expect(ids).toEqual(expect.arrayContaining([empresaA, empresaB]))
    })

    it('a funcao so devolve id — nunca legal_name, cnpj ou email', async () => {
      const linhas = await withPlatformScope(
        sql,
        (tx) => tx<Record<string, unknown>[]>`SELECT * FROM list_company_ids() LIMIT 1`,
      )
      expect(Object.keys(linhas[0] ?? {})).toEqual(['id'])
    })

    it('list_company_ids e SECURITY DEFINER com search_path fixo', async () => {
      const [fn] = await sql<{ prosecdef: boolean; proconfig: string[] | null }[]>`
        SELECT p.prosecdef, p.proconfig
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'list_company_ids'
           AND p.pronargs = 0
      `
      expect(fn?.prosecdef).toBe(true)
      expect(fn?.proconfig, 'list_company_ids sem search_path').toEqual(
        expect.arrayContaining([expect.stringMatching(/^search_path=/)]),
      )
    })
  })

  it('loadActive com number_from vazio devolve undefined e nao cria row', async () => {
    const chaveVazia = `app:${empresaA}:`
    const antes = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ n: string }[]>`SELECT count(*)::text AS n FROM conversations`,
    )

    const ativo = await store.loadActive(empresaA, chaveVazia, agora)
    expect(ativo).toBeUndefined()

    const depois = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ n: string }[]>`SELECT count(*)::text AS n FROM conversations`,
    )
    expect(depois[0]?.n).toBe(antes[0]?.n)
  })
})
