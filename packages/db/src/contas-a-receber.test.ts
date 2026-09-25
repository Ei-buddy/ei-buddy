import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import {
  createManualReceivableUnitOfWork,
  createReceivableRepository,
} from './receivable-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * A leitura dos recebiveis sob RLS — NR-074, RF-064, RF-066.
 *
 * Tres coisas que so o banco decide: o isolamento entre lojas, o `bigint` que
 * volta como string, e o `date` que o driver converte para meia-noite UTC — em
 * America/Sao_Paulo, uma conta que vence dia 10 apareceria vencendo dia 9.
 *
 * Conexao de papel COMUM: na do dono a RLS nunca e avaliada, e o teste de
 * isolamento ficaria verde medindo o vazio.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('contas a receber — NR-074', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let clienteA: string

  let repo: ReturnType<typeof createReceivableRepository>

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`r@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  async function criarRecebivel(
    empresa: string,
    dados: {
      vencimento: string
      valorCents?: number
      liquidoCents?: number
      baixadoCents?: number
      status?: string
      clienteId?: string | null
      descricao?: string
    },
  ): Promise<string> {
    const id = randomUUID()
    const valor = dados.valorCents ?? 10_000

    const status = dados.status ?? 'open'

    /*
     * `settled_at` acompanha o status, por causa do CHECK
     * `receivables_liquidado_completo`. Nao e detalhe do teste: o schema
     * recusa "recebido sem data de recebimento" de proposito, para o relatorio
     * nunca ter duas respostas sobre quando o dinheiro entrou.
     */
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO receivables
          (id, company_id, customer_id, origin, description, amount_cents,
           net_amount_cents, settled_amount_cents, due_date, status, settled_at)
        VALUES (${id}, ${empresa}, ${dados.clienteId ?? null}, 'manual',
                ${dados.descricao ?? 'Venda fiado'}, ${valor},
                ${dados.liquidoCents ?? valor},
                ${dados.baixadoCents ?? (status === 'settled' ? valor : 0)},
                ${dados.vencimento}, ${status},
                ${status === 'settled' ? new Date('2026-09-14T12:00:00.000Z') : null})
      `,
    )
    return id
  }

  const emAberto = (empresa: string) =>
    repo.list(empresa, { status: ['open', 'partially_settled'] })

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0002_dominio_0909')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    repo = createReceivableRepository(sql)

    empresaA = await criarEmpresa(cnpjDeTeste('2'), 'Loja Receber A')
    empresaB = await criarEmpresa(cnpjDeTeste('4'), 'Loja Receber B')

    const [cliente] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO customers (company_id, name) VALUES (${empresaA}, 'Dona Marta')
        RETURNING id
      `,
    )
    clienteA = cliente!.id
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM receivables`
        await tx`DELETE FROM customers`
        await tx`DELETE FROM companies`
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  it('traz o nome do cliente junto, sem uma segunda consulta', async () => {
    await criarRecebivel(empresaA, { vencimento: '2026-09-10', clienteId: clienteA })

    const lista = await emAberto(empresaA)

    /* Buscar o nome por recebivel daria uma ida ao banco por LINHA, e a lista
       mostra o nome em todas. */
    expect(lista.find((r) => r.customerName === 'Dona Marta')).toBeDefined()
  })

  /*
   * O `LEFT JOIN` e o ponto: venda sem identificar o cliente e caminho normal
   * no balcao (RF-009), e um INNER faria esses recebiveis SUMIREM da lista —
   * dinheiro a receber que a tela nao mostra.
   */
  it('recebivel sem cliente entra na lista, com o nome nulo', async () => {
    await criarRecebivel(empresaA, {
      vencimento: '2026-09-11',
      clienteId: null,
      descricao: 'Balcao sem cadastro',
    })

    const achado = (await emAberto(empresaA)).find((r) => r.description === 'Balcao sem cadastro')

    expect(achado).toBeDefined()
    expect(achado?.customerName).toBeNull()
  })

  /*
   * O postgres.js converte `date` para meia-noite UTC. Em America/Sao_Paulo
   * (UTC-3) isso vira o dia ANTERIOR ao formatar: a conta que vence dia 12
   * apareceria vencendo dia 11. O `to_char` devolve texto e corta o problema.
   */
  it('o vencimento volta como TEXTO, no dia certo', async () => {
    await criarRecebivel(empresaA, { vencimento: '2026-09-12', descricao: 'Dia doze' })

    const achado = (await emAberto(empresaA)).find((r) => r.description === 'Dia doze')

    expect(achado?.dueDate).toBe('2026-09-12')
  })

  /*
   * `bigint` volta como STRING no postgres.js, para nao perder precisao acima
   * de 2^53. Sem a conversao na borda, um valor em string entrando num calculo
   * estoura com "Cannot mix BigInt and other types".
   */
  it('os valores voltam como NUMERO, e nao como string', async () => {
    await criarRecebivel(empresaA, {
      vencimento: '2026-09-13',
      valorCents: 123_456,
      liquidoCents: 120_000,
      descricao: 'Valores',
    })

    const achado = (await emAberto(empresaA)).find((r) => r.description === 'Valores')

    expect(achado?.amountCents).toBe(123_456)
    expect(achado?.netAmountCents).toBe(120_000)
    expect(typeof achado?.amountCents).toBe('number')
  })

  it('filtra por situacao no SQL — o recebido nao vem', async () => {
    await criarRecebivel(empresaA, {
      vencimento: '2026-09-14',
      status: 'settled',
      descricao: 'Ja recebido',
    })

    /* Trazer tudo para descartar depois cresce com o historico da loja — que e
       justamente o que nao para de crescer. */
    expect((await emAberto(empresaA)).map((r) => r.description)).not.toContain('Ja recebido')

    /* Controle: existe, e aparece quando pedido. */
    const todos = await repo.list(empresaA, { status: ['settled'] })
    expect(todos.map((r) => r.description)).toContain('Ja recebido')
  })

  it('ordena por vencimento, do mais proximo ao mais distante', async () => {
    const so = (await emAberto(empresaA)).map((r) => r.dueDate)

    expect([...so].sort()).toEqual(so)
  })

  it('recebivel de outra loja e invisivel', async () => {
    await criarRecebivel(empresaB, {
      vencimento: '2026-09-15',
      descricao: 'So da loja B',
      valorCents: 99_999,
    })

    /* Controle antes da assercao: a linha EXISTE. Sem isto, o teste passaria
       com a tabela vazia e nao provaria nada sobre isolamento. */
    expect((await emAberto(empresaB)).map((r) => r.description)).toContain('So da loja B')

    expect((await emAberto(empresaA)).map((r) => r.description)).not.toContain('So da loja B')
  })
})

describe.skipIf(!DATABASE_URL)('lancar recebivel avulso — NR-074, RF-065', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let usuarioA: string
  let clienteA: string

  let uow: ReturnType<typeof createManualReceivableUnitOfWork>

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0002_dominio_0909')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    uow = createManualReceivableUnitOfWork(sql)

    const id = randomUUID()
    const cnpj = cnpjDeTeste('3')
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, 'Loja Avulso', ${cnpj}, ${`a@${cnpj}.local`}, '41999990000')
      `,
    )
    empresaA = id

    usuarioA = randomUUID()
    await withTenant(sql, empresaA, async (tx) => {
      await tx`
        INSERT INTO users (id, name, email) VALUES (${usuarioA}, 'Dono', ${`d${usuarioA}@local`})
      `
      await tx`
        INSERT INTO company_users (company_id, user_id, role)
        VALUES (${empresaA}, ${usuarioA}, 'owner')
      `
    })

    const [cliente] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO customers (company_id, name) VALUES (${empresaA}, 'Seu Renato')
        RETURNING id
      `,
    )
    clienteA = cliente!.id
  }, 60_000)

  /*
   * SEM limpeza de linha aqui — `audit_logs` e so-insercao (RF-124, trigger
   * `audit_logs_somente_insercao`): um `DELETE`, mesmo em cascata a partir de
   * `companies`, e recusado pelo banco. `trilha.test.ts` segue o mesmo
   * caminho. A CI sobe um Postgres NOVO por execucao, entao a sobra nao
   * acumula; so importa para quem roda a suite contra um Postgres persistente
   * localmente.
   */
  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  it('grava com origin manual, sem venda por tras', async () => {
    const gravado = await uow.transaction(empresaA, (tx) =>
      tx.insert({
        companyId: empresaA,
        description: 'Emprestimo a receber',
        amountCents: 50_000,
        dueDate: '2026-09-20',
        customerId: null,
        accountId: null,
        isCustomerDebt: false,
        createdBy: usuarioA,
        createdAt: new Date('2026-09-11T13:00:00.000Z'),
      }),
    )

    expect(gravado.saleId).toBeNull()
    expect(gravado.status).toBe('open')
    expect(gravado.installmentNumber).toBe(1)
    expect(gravado.installmentCount).toBe(1)
  })

  it('liquido e bruto saem iguais — sem tarifa de adquirente', async () => {
    const gravado = await uow.transaction(empresaA, (tx) =>
      tx.insert({
        companyId: empresaA,
        description: 'Aluguel',
        amountCents: 80_000,
        dueDate: '2026-09-21',
        customerId: null,
        accountId: null,
        isCustomerDebt: false,
        createdBy: usuarioA,
        createdAt: new Date('2026-09-11T13:00:00.000Z'),
      }),
    )

    expect(gravado.amountCents).toBe(80_000)
    expect(gravado.netAmountCents).toBe(80_000)
  })

  it('com cliente, traz o nome junto — sem segunda consulta', async () => {
    const gravado = await uow.transaction(empresaA, (tx) =>
      tx.insert({
        companyId: empresaA,
        description: 'Fiado antigo',
        amountCents: 12_000,
        dueDate: '2026-09-22',
        customerId: clienteA,
        accountId: null,
        isCustomerDebt: false,
        createdBy: usuarioA,
        createdAt: new Date('2026-09-11T13:00:00.000Z'),
      }),
    )

    expect(gravado.customerId).toBe(clienteA)
    expect(gravado.customerName).toBe('Seu Renato')
  })

  it('deixa rastro na trilha, DENTRO da transacao', async () => {
    await uow.transaction(empresaA, async (tx) => {
      const gravado = await tx.insert({
        companyId: empresaA,
        description: 'Com trilha',
        amountCents: 30_000,
        dueDate: '2026-09-23',
        customerId: null,
        accountId: null,
        isCustomerDebt: false,
        createdBy: usuarioA,
        createdAt: new Date('2026-09-11T13:00:00.000Z'),
      })

      await tx.record({
        companyId: empresaA,
        entity: 'Receivable',
        entityId: gravado.id,
        action: 'created',
        actorId: usuarioA,
        channel: 'app',
        occurredAt: new Date('2026-09-11T13:00:00.000Z'),
        before: null,
        after: { amountCents: 30_000 },
      })
    })

    const [entrada] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ entity: string; action: string }[]>`
        SELECT entity, action FROM audit_logs WHERE entity = 'Receivable' AND action = 'created'
      `,
    )
    expect(entrada?.entity).toBe('Receivable')
  })
})
