import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Schema de cadastros — NR-008.
 *
 * Alem de conferir as tabelas, esta suite tem uma guarda que vale para todas as
 * proximas migrations: **nenhuma tabela de negocio pode nascer sem RLS
 * forcado**. O README de `db` lista isso como regra de migration, e regra que
 * so existe em documento e regra que ja foi quebrada — so ninguem percebeu
 * ainda. Aqui ela reprova o PR.
 *
 * Como em `tenant.test.ts`: pulada sem `DATABASE_URL`, executada na CI, e com
 * as asserções rodando por um papel COMUM — com a conexao de administrador,
 * superusuario ignora RLS e a suite mediria o vazio.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

/** Tabelas que NAO sao de negocio e por isso nao seguem a regra do company_id. */
/* 'partners' e 'coupons' saem daqui na NR-114 (ADR-0013): passam a ter
   FORCE ROW LEVEL SECURITY sem politica, como company_connections. */
const NAO_TENANT = new Set(['schema_migrations', 'waitlist_entries'])

describe.skipIf(!DATABASE_URL)('schema de cadastros — NR-008', () => {
  /** Administrador: papel de teste, concessoes e leitura de catalogo. */
  let admin: Sql
  /** Aplicacao, com papel comum — e nela que o isolamento vale. */
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string

  /** Cria a empresa sob o proprio tenant — o padrao que a politica raiz impoe. */
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
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0002_dominio_0909')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    /*
     * CNPJ com EXATAMENTE 14 digitos, e unico global.
     *
     * A primeira versao montava `1${marca}0001` com uma marca de 8 digitos e
     * dava 13 — a CI reprovou com `companies_cnpj_digitos`. `Date.now()` tem
     * 13 digitos, entao um digito de prefixo fecha 14 na conta, e o prefixo
     * distingue as duas empresas criadas no mesmo milissegundo.
     */
    empresaA = await criarEmpresa(cnpjDeTeste('1'), 'Mercearia A')
    empresaB = await criarEmpresa(cnpjDeTeste('2'), 'Mercearia B')
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    /* Limpa o que este teste criou, na ordem das dependencias. Sem o tenant
       definido nada disso e visivel, entao a limpeza tambem passa por ele. */
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM products`
        await tx`DELETE FROM customers`
        await tx`DELETE FROM categories`
        await tx`DELETE FROM company_users`
        await tx`DELETE FROM companies`
        /* `users` fica: a politica dela exige vinculo, e o vinculo acabou de
           ser apagado — a linha some da visao antes de dar para apaga-la.
           Limpar identidade orfa e tarefa de plataforma, nao de teste. */
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  it('toda tabela de negocio nasce com RLS habilitado E forcado', async () => {
    const tabelas = await admin<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `

    const desprotegidas = tabelas
      .filter((t) => !NAO_TENANT.has(t.relname) && !t.relname.startsWith('nr00'))
      .filter((t) => !t.relrowsecurity || !t.relforcerowsecurity)
      .map((t) => t.relname)

    /* Esquecer o RLS numa tabela nova e vazamento entre lojas. A mensagem
       precisa nomear a tabela para quem quebrou saber onde. */
    expect(desprotegidas).toEqual([])
  })

  it('toda tabela com company_id tem a politica tenant_isolation', async () => {
    const semPolitica = await admin<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND NOT EXISTS (
          SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'
        )
      ORDER BY c.relname
    `
    expect(semPolitica.map((t) => t.relname)).toEqual([])
  })

  it('a empresa nasce sob o proprio tenant e se enxerga', async () => {
    const [linha] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ legal_name: string }[]>`SELECT legal_name FROM companies`,
    )
    expect(linha?.legal_name).toBe('Mercearia A')
  })

  it('uma empresa nao enxerga a outra', async () => {
    const vistas = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ id: string }[]>`SELECT id FROM companies`,
    )
    expect(vistas.map((r) => r.id)).toEqual([empresaA])
  })

  it('nao grava empresa com id diferente do tenant do contexto', async () => {
    /* A alternativa a esta politica seria `WITH CHECK (true)` na insercao, e
       ela deixaria qualquer contexto criar linha de qualquer empresa. */
    await expect(
      withTenant(
        sql,
        empresaA,
        (tx) =>
          tx`
          INSERT INTO companies (id, legal_name, cnpj, email, phone)
          VALUES (${randomUUID()}, 'Empresa Plantada', '99999999999999', 'x@y.local', '41999990000')
        `,
      ),
    ).rejects.toThrow(/row-level security|violates/i)
  })

  it('recusa CNPJ repetido — RF-002', async () => {
    const [existente] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ cnpj: string }[]>`SELECT cnpj FROM companies`,
    )
    const id = randomUUID()

    await expect(
      withTenant(
        sql,
        id,
        (tx) =>
          tx`
          INSERT INTO companies (id, legal_name, cnpj, email, phone)
          VALUES (${id}, 'Outra Loja', ${existente!.cnpj}, 'z@w.local', '41999990000')
        `,
      ),
    ).rejects.toThrow(/companies_cnpj_unico|duplicate key/i)
  })

  it('recusa CNPJ que nao tem 14 digitos', async () => {
    const id = randomUUID()
    await expect(
      withTenant(
        sql,
        id,
        (tx) =>
          tx`
          INSERT INTO companies (id, legal_name, cnpj, email, phone)
          VALUES (${id}, 'Loja', '123', 'a@b.local', '41999990000')
        `,
      ),
    ).rejects.toThrow(/companies_cnpj_digitos|violates check/i)
  })

  it('recusa regime tributario que nao existe', async () => {
    const id = randomUUID()
    await expect(
      withTenant(
        sql,
        id,
        (tx) =>
          tx`
          INSERT INTO companies (id, legal_name, cnpj, email, phone, tax_regime)
          VALUES (${id}, 'Loja', '33333333333333', 'a@b.local', '41999990000', 'inventado')
        `,
      ),
    ).rejects.toThrow(/tax_regime|violates check/i)
  })

  it('cliente exige apenas nome — RF-009', async () => {
    const [cliente] = await withTenant(
      sql,
      empresaA,
      (tx) =>
        tx<{ id: string; wallet_balance_cents: string }[]>`
        INSERT INTO customers (company_id, name) VALUES (${empresaA}, 'Joao do Bar')
        RETURNING id, wallet_balance_cents
      `,
    )
    expect(cliente?.id).toBeTruthy()
    /* Saldo de fiado comeca em zero, nao em nulo: nulo obrigaria todo calculo
       a tratar ausencia, e "nao deve nada" e zero. */
    expect(Number(cliente?.wallet_balance_cents)).toBe(0)
  })

  it('cliente de uma loja nao aparece na outra', async () => {
    await withTenant(
      sql,
      empresaB,
      (tx) => tx`INSERT INTO customers (company_id, name) VALUES (${empresaB}, 'Maria da Feira')`,
    )

    const naA = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ name: string }[]>`SELECT name FROM customers WHERE name = 'Maria da Feira'`,
    )
    expect(naA).toEqual([])
  })

  it('o mesmo codigo de barras vale em duas lojas, e nao duas vezes na mesma', async () => {
    const ean = '7891234567895'

    for (const empresa of [empresaA, empresaB]) {
      await withTenant(
        sql,
        empresa,
        (tx) =>
          tx`
          INSERT INTO products (company_id, description, barcode, internal_code,
                                unit_of_measure, sale_price_cents)
          VALUES (${empresa}, 'Cafe 500g', ${ean}, ${'INT-' + empresa.slice(0, 8)}, 'un', 1990)
        `,
      )
    }

    /* Duas lojas vendem o mesmo produto: EAN igual nas duas e o caso normal. */
    await expect(
      withTenant(
        sql,
        empresaA,
        (tx) =>
          tx`
          INSERT INTO products (company_id, description, barcode, internal_code,
                                unit_of_measure, sale_price_cents)
          VALUES (${empresaA}, 'Cafe 500g repetido', ${ean}, 'INT-OUTRO', 'un', 1990)
        `,
      ),
    ).rejects.toThrow(/products_barcode_unico|duplicate key/i)
  })

  it('recusa unidade de medida que nao existe', async () => {
    await expect(
      withTenant(
        sql,
        empresaA,
        (tx) =>
          tx`
          INSERT INTO products (company_id, description, internal_code,
                                unit_of_measure, sale_price_cents)
          VALUES (${empresaA}, 'Produto', 'INT-UN', 'duzia', 1000)
        `,
      ),
    ).rejects.toThrow(/unit_of_measure|violates check/i)
  })

  it('recusa aliquota fora de 0 a 100 — a coluna guarda pontos, nao fracao', async () => {
    await expect(
      withTenant(
        sql,
        empresaA,
        (tx) =>
          tx`
          INSERT INTO products (company_id, description, internal_code,
                                unit_of_measure, sale_price_cents, tax_rate)
          VALUES (${empresaA}, 'Produto', 'INT-TAX', 'un', 1000, 150)
        `,
      ),
    ).rejects.toThrow(/tax_rate|violates check/i)
  })

  /**
   * Cria a pessoa e o vinculo, com o id gerado aqui.
   *
   * Nao usa `RETURNING id`, e a razao e sutil: `INSERT ... RETURNING` aplica a
   * politica de SELECT as linhas devolvidas, e a politica de `users` exige
   * vinculo em `company_users` — que nao existe ainda no instante do insert.
   * O `RETURNING` voltaria vazio. Gerar o id na aplicacao resolve, e e o mesmo
   * padrao que a politica raiz de `companies` ja impoe.
   */
  async function criarUsuario(empresa: string, nome: string, papel = 'owner') {
    const id = randomUUID()
    const email = `${nome.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}@loja.local`
    await withTenant(sql, empresa, async (tx) => {
      await tx`INSERT INTO users (id, name, email) VALUES (${id}, ${nome}, ${email})`
      await tx`
        INSERT INTO company_users (company_id, user_id, role)
        VALUES (${empresa}, ${id}, ${papel})
      `
    })
    return { id, email }
  }

  it('usuario e visto so por quem tem vinculo com ele', async () => {
    const usuario = await criarUsuario(empresaA, 'Dono da A')

    const naA = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ email: string }[]>`SELECT email FROM users WHERE id = ${usuario.id}`,
    )
    const naB = await withTenant(
      sql,
      empresaB,
      (tx) => tx<{ email: string }[]>`SELECT email FROM users WHERE id = ${usuario.id}`,
    )

    /*
     * `users` nao tem company_id — a mesma pessoa opera mais de uma loja. Mas
     * nao ter company_id nao pode significar ser visivel a todos: e-mail e
     * telefone sao dado pessoal. A politica passa por company_users.
     */
    expect(naA.map((r) => r.email)).toEqual([usuario.email])
    expect(naB).toEqual([])
  })

  it('a mesma pessoa pode operar duas lojas', async () => {
    const usuario = await criarUsuario(empresaA, 'Contadora')
    await withTenant(
      sql,
      empresaB,
      (tx) =>
        tx`
        INSERT INTO company_users (company_id, user_id, role)
        VALUES (${empresaB}, ${usuario.id}, 'accountant')
      `,
    )

    /* E o motivo de `users` nao ter company_id: uma identidade, dois vinculos. */
    for (const empresa of [empresaA, empresaB]) {
      const visto = await withTenant(
        sql,
        empresa,
        (tx) => tx<{ id: string }[]>`SELECT id FROM users WHERE id = ${usuario.id}`,
      )
      expect(visto.map((r) => r.id)).toEqual([usuario.id])
    }
  })

  it('recusa papel que nao existe', async () => {
    await expect(criarUsuario(empresaA, 'Alguem', 'gerente')).rejects.toThrow(
      /role|violates check/i,
    )
  })

  it('todo indice de tabela de negocio comeca por company_id', async () => {
    /*
     * Com RLS, toda consulta filtra por company_id. Indice que nao o tem na
     * frente quase nunca e usado — e indice nao usado e custo de escrita sem
     * ganho de leitura (dados.md#índices-obrigatórios).
     *
     * A chave primaria fica de fora: `id` e unico global por construcao.
     */
    const fora = await admin<{ tabela: string; indice: string; primeira: string }[]>`
      SELECT c.relname AS tabela, i.relname AS indice, a.attname AS primeira
      FROM pg_index x
      JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute ca ON ca.attrelid = c.oid AND ca.attname = 'company_id'
                          AND NOT ca.attisdropped
      LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.indkey[0]
      WHERE n.nspname = 'public'
        AND NOT x.indisprimary
        AND (a.attname IS DISTINCT FROM 'company_id')
      ORDER BY c.relname, i.relname
    `

    /*
     * Duas excecoes conscientes, e as duas pelo mesmo motivo de fundo: sao
     * consultas que NAO tem empresa no contexto.
     *
     * - `company_users_por_usuario` acha as lojas de UMA pessoa, para a tela de
     *   trocar de empresa — antes de haver empresa escolhida.
     * - `support_tickets_protocolo_unico` garante que o protocolo e unico na
     *   PLATAFORMA. E o numero que o lojista fala ao telefone, e a equipe de
     *   suporte precisa achar o chamado sem perguntar de qual loja e. Prefixar
     *   com `company_id` deixaria dois chamados diferentes com o mesmo numero,
     *   que e exatamente o que o protocolo existe para evitar.
     * - `lojista_free_month_credits_source_unique` (ADR-0013) garante um
     *   credito por resgate, e `source_redemption_id` ja e globalmente unico
     *   (referencia `coupon_redemptions`, tabela cross-tenant sem
     *   `company_id`) — prefixar com `company_id` seria redundante, nao mais
     *   seguro.
     */
    expect(fora.map((r) => `${r.tabela}.${r.indice}`)).toEqual([
      'company_integrations.company_integrations_payments_account_id_idx',
      'company_users.company_users_por_usuario',
      'lojista_free_month_credits.lojista_free_month_credits_source_unique',
      'payments.payments_provider_event_id_idx',
      'payments.payments_provider_payment_id_idx',
      'subscriptions.subscriptions_provider_subscription_id_idx',
      'support_tickets.support_tickets_protocolo_unico',
      'webhook_events.webhook_events_provider_event_unique',
    ])
  })
})
