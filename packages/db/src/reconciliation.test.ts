import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createBankTransactionWriter,
  createReconciliationQueries,
  createReconciliationUnitOfWork,
} from './bank-transaction-repository.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Extrato bancario e conciliacao — NR-076, RF-076 a RF-080.
 *
 * As regras (janela, casamento por valor, quem pode escrever) tem teste em
 * `core`, contra um falso. O que se prova AQUI e o que so o banco pode provar:
 * que a deduplicacao e do indice e nao de um `SELECT`, que a escrita
 * condicional decide o empate, que um lancamento nao e conciliado duas vezes, e
 * que nada disso vaza entre lojas.
 *
 * Como as outras de `db`: pulada sem `DATABASE_URL`, executada na CI, e com as
 * asserções por um papel COMUM — com a conexao de administrador, superusuario
 * ignora RLS e o teste de isolamento mediria o vazio.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('extrato e conciliacao — NR-076', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let usuarioA: string

  let writer: ReturnType<typeof createBankTransactionWriter>
  let uow: ReturnType<typeof createReconciliationUnitOfWork>
  let queries: ReturnType<typeof createReconciliationQueries>

  const AGORA = new Date('2026-09-15T12:00:00.000Z')

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

  async function criarConta(
    empresa: string,
    valorCents: number,
    vencimento: string,
  ): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO payables (id, company_id, supplier, description, amount_cents, due_date)
        VALUES (${id}, ${empresa}, 'Enel', 'Energia', ${valorCents}, ${vencimento})
      `,
    )
    return id
  }

  const transacao = (empresa: string, over: Record<string, unknown> = {}) => ({
    companyId: empresa,
    externalId: 'FITID-1',
    direction: 'debit' as const,
    amountCents: 5_000,
    postedOn: '2026-09-10',
    description: 'PAGAMENTO ENERGIA',
    counterparty: null,
    importedBy: usuarioA,
    importedAt: AGORA,
    ...over,
  })

  /** O id da transacao gravada, que o writer nao devolve (ele devolve contagem). */
  async function idDaTransacao(empresa: string, externalId: string): Promise<string> {
    const [linha] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM bank_transactions WHERE external_id = ${externalId}
      `,
    )
    return linha!.id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0006_extrato_bancario')

    admin = postgres(DATABASE_URL!, { max: 6, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('7'), 'Loja de Extrato A')
    empresaB = await criarEmpresa(cnpjDeTeste('8'), 'Loja de Extrato B')

    usuarioA = randomUUID()
    await admin`
      INSERT INTO users (id, name, email) VALUES (${usuarioA}, 'Dono', ${`d${usuarioA}@local`})
    `

    writer = createBankTransactionWriter(sql)
    uow = createReconciliationUnitOfWork(sql)
    queries = createReconciliationQueries(sql)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM bank_transactions`
        await tx`DELETE FROM settlements`
        await tx`DELETE FROM receivables`
        await tx`DELETE FROM payables`
        /* Depois dos lancamentos: `account_id` referencia com RESTRICT. */
        await tx`DELETE FROM ledger_accounts`
        await tx`DELETE FROM companies`
      })
    }
    await admin`DELETE FROM users WHERE id = ${usuarioA}`
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  describe('importar — RF-076', () => {
    it('grava e conta o que entrou', async () => {
      const n = await writer.insertIgnoringDuplicates([
        transacao(empresaA, { externalId: 'IMP-1' }),
        transacao(empresaA, { externalId: 'IMP-2', amountCents: 1_200 }),
      ])

      expect(n).toBe(2)
    })

    it('a duplicata e barrada pelo INDICE, e nao contada como nova', async () => {
      await writer.insertIgnoringDuplicates([transacao(empresaA, { externalId: 'DUP-1' })])

      /* Mesmo externalId de novo, junto de uma inedita: so a inedita entra. O
         `ON CONFLICT` tem de valer POR LINHA — se o lote inteiro fosse
         descartado, o numero seria 0 e a transacao nova sumiria em silencio. */
      const n = await writer.insertIgnoringDuplicates([
        transacao(empresaA, { externalId: 'DUP-1' }),
        transacao(empresaA, { externalId: 'DUP-2' }),
      ])

      expect(n).toBe(1)
    })

    it('o mesmo FITID vale nas duas lojas — o indice e por empresa', async () => {
      await writer.insertIgnoringDuplicates([transacao(empresaA, { externalId: 'MESMO' })])
      const n = await writer.insertIgnoringDuplicates([
        transacao(empresaB, { externalId: 'MESMO' }),
      ])

      /* Dois bancos diferentes emitem o mesmo FITID sem combinar. Unicidade
         global tornaria a segunda loja incapaz de importar o proprio extrato. */
      expect(n).toBe(1)
    })
  })

  describe('conciliar — RF-079', () => {
    it('amarra a transacao ao lancamento e o tira da fila', async () => {
      await writer.insertIgnoringDuplicates([transacao(empresaA, { externalId: 'CONC-1' })])
      const tId = await idDaTransacao(empresaA, 'CONC-1')
      const conta = await criarConta(empresaA, 5_000, '2026-09-10')

      const casou = await uow.transaction(empresaA, (tx) =>
        tx.link(empresaA, tId, 'payable', conta, AGORA),
      )

      expect(casou).toBe(true)

      const fila = await queries.listTransactions(empresaA, 'pending')
      expect(fila.map((t) => t.id)).not.toContain(tId)

      const feitas = await queries.listTransactions(empresaA, 'reconciled')
      const nossa = feitas.find((t) => t.id === tId)
      expect(nossa?.reconciledEntryKind).toBe('payable')
      expect(nossa?.reconciledWith).toMatchObject({ counterparty: 'Enel', id: conta })
    })

    it('a segunda aba perde: `link` devolve false em vez de sobrescrever', async () => {
      await writer.insertIgnoringDuplicates([transacao(empresaA, { externalId: 'CORRIDA-1' })])
      const tId = await idDaTransacao(empresaA, 'CORRIDA-1')
      const conta1 = await criarConta(empresaA, 5_000, '2026-09-10')
      const conta2 = await criarConta(empresaA, 5_000, '2026-09-10')

      const primeira = await uow.transaction(empresaA, (tx) =>
        tx.link(empresaA, tId, 'payable', conta1, AGORA),
      )
      const segunda = await uow.transaction(empresaA, (tx) =>
        tx.link(empresaA, tId, 'payable', conta2, AGORA),
      )

      expect(primeira).toBe(true)
      /* O `WHERE reconciled_at IS NULL` e a decisao. Sem ele a segunda
         sobrescreveria a primeira e a conta 1 ficaria conciliada com nada. */
      expect(segunda).toBe(false)
    })

    it('um lancamento nao e conciliado por DUAS transacoes', async () => {
      await writer.insertIgnoringDuplicates([
        transacao(empresaA, { externalId: 'DISPUTA-1' }),
        transacao(empresaA, { externalId: 'DISPUTA-2' }),
      ])
      const t1 = await idDaTransacao(empresaA, 'DISPUTA-1')
      const t2 = await idDaTransacao(empresaA, 'DISPUTA-2')
      const conta = await criarConta(empresaA, 5_000, '2026-09-10')

      await uow.transaction(empresaA, (tx) => tx.link(empresaA, t1, 'payable', conta, AGORA))
      const segunda = await uow.transaction(empresaA, (tx) =>
        tx.link(empresaA, t2, 'payable', conta, AGORA),
      )

      /* Este empate esta do OUTRO lado: o `WHERE` olha a transacao, e t2 nunca
         foi conciliada. Quem recusa e o indice unico por lancamento — sem ele,
         a conferencia daria dois pagamentos como provados por uma saida so. */
      expect(segunda).toBe(false)
    })

    it('recusar o empate deixa a transacao de fora AINDA utilizavel', async () => {
      await writer.insertIgnoringDuplicates([
        transacao(empresaA, { externalId: 'VIVA-1' }),
        transacao(empresaA, { externalId: 'VIVA-2' }),
      ])
      const t1 = await idDaTransacao(empresaA, 'VIVA-1')
      const t2 = await idDaTransacao(empresaA, 'VIVA-2')
      const conta = await criarConta(empresaA, 5_000, '2026-09-10')

      await uow.transaction(empresaA, (tx) => tx.link(empresaA, t1, 'payable', conta, AGORA))

      /*
       * O teste que faltava. O primeiro corte confiava so no indice unico e num
       * `catch` do 23505 — e em Postgres um statement que falha aborta a
       * transacao INTEIRA, entao o `catch` devolvia `false`, o COMMIT vinha
       * por cima de uma transacao morta e o erro original voltava assim mesmo.
       *
       * Provar que `link` devolve `false` nao bastava: ele devolvia. O que
       * quebrava era tudo que viesse DEPOIS, dentro da mesma transacao — e e
       * exatamente o que `createEntryFromTransaction` faz.
       */
      const resultado = await uow.transaction(empresaA, async (tx) => {
        const casou = await tx.link(empresaA, t2, 'payable', conta, AGORA)
        const aindaLe = await tx.findTransaction(empresaA, t2)
        return { casou, aindaLe }
      })

      expect(resultado.casou).toBe(false)
      expect(resultado.aindaLe?.id).toBe(t2)
    })

    it('desfazer devolve os dois para a fila, sem apagar o lancamento', async () => {
      await writer.insertIgnoringDuplicates([transacao(empresaA, { externalId: 'UNDO-1' })])
      const tId = await idDaTransacao(empresaA, 'UNDO-1')
      const conta = await criarConta(empresaA, 5_000, '2026-09-10')

      await uow.transaction(empresaA, (tx) => tx.link(empresaA, tId, 'payable', conta, AGORA))
      await uow.transaction(empresaA, (tx) => tx.unlink(empresaA, tId))

      const fila = await queries.listTransactions(empresaA, 'pending')
      expect(fila.map((t) => t.id)).toContain(tId)

      /* RF-080: desfazer a conferencia nao apaga a conta a pagar. */
      const [ainda] = await withTenant(
        sql,
        empresaA,
        (tx) => tx<{ id: string }[]>`SELECT id FROM payables WHERE id = ${conta}`,
      )
      expect(ainda?.id).toBe(conta)
    })
  })

  describe('criar lancamento a partir da transacao — RF-079', () => {
    it('grava a conta a pagar com a data do EXTRATO', async () => {
      const criado = await uow.transaction(empresaA, (tx) =>
        tx.insertEntry({
          companyId: empresaA,
          entryKind: 'payable',
          counterparty: 'Tarifa do banco',
          description: 'Manutencao de conta',
          amountCents: 3_490,
          dueDate: '2026-09-10',
          accountId: null,
          createdBy: usuarioA,
          createdAt: AGORA,
        }),
      )

      const achado = await uow.transaction(empresaA, (tx) =>
        tx.findEntry(empresaA, 'payable', criado.id),
      )

      /* A data e a do banco, e nao "hoje": datar com o agora colocaria no mes
         errado toda conciliacao feita no comeco do mes seguinte — que e
         justamente quando o lojista senta para conciliar. */
      expect(achado?.dueDate).toBe('2026-09-10')
      expect(achado?.counterparty).toBe('Tarifa do banco')
      expect(achado?.amountCents).toBe(3_490)
    })

    it('o recebivel criado guarda a origem em texto, sem cliente cadastrado', async () => {
      const criado = await uow.transaction(empresaA, (tx) =>
        tx.insertEntry({
          companyId: empresaA,
          entryKind: 'receivable',
          counterparty: 'Maria Souza',
          description: 'Transferencia recebida',
          amountCents: 12_000,
          dueDate: '2026-09-11',
          accountId: null,
          createdBy: usuarioA,
          createdAt: AGORA,
        }),
      )

      const achado = await uow.transaction(empresaA, (tx) =>
        tx.findEntry(empresaA, 'receivable', criado.id),
      )

      expect(achado?.counterparty).toBe('Maria Souza')
      /* Veio do extrato: o valor JA e o que caiu, nao ha tarifa a prever. */
      expect(achado?.netAmountCents).toBe(12_000)
    })

    it('grava a conta contabil escolhida — RF-083', async () => {
      const [conta] = await withTenant(
        sql,
        empresaA,
        (tx) => tx<{ id: string }[]>`
          INSERT INTO ledger_accounts (company_id, name, type)
          VALUES (${empresaA}, 'Tarifas bancarias', 'expense')
          RETURNING id
        `,
      )

      const criado = await uow.transaction(empresaA, (tx) =>
        tx.insertEntry({
          companyId: empresaA,
          entryKind: 'payable',
          counterparty: 'Banco',
          description: 'Tarifa de manutencao',
          amountCents: 3_490,
          dueDate: '2026-09-10',
          accountId: conta!.id,
          createdBy: usuarioA,
          createdAt: AGORA,
        }),
      )

      /*
       * Ate a NR-077 este caminho LANCAVA: nao havia tabela `accounts`, e
       * gravar sem a conta seria descartar em silencio uma classificacao que o
       * lojista acredita ter feito. Agora a coluna existe e o que se prova e
       * que ela chega no banco.
       */
      const [linha] = await withTenant(
        sql,
        empresaA,
        (tx) => tx<{ account_id: string | null }[]>`
          SELECT account_id FROM payables WHERE id = ${criado.id}
        `,
      )
      expect(linha?.account_id).toBe(conta!.id)
    })
  })

  describe('candidatos — RF-078', () => {
    /* Conta que vence dia 25 e foi paga dia 10 sai do banco dia 10. So pelo
       vencimento ela nunca era sugerida — achado do QA. */
    it('acha a conta pela data da BAIXA, nao so pelo vencimento', async () => {
      const conta = await criarConta(empresaA, 4_200, '2026-09-25')
      await withTenant(
        sql,
        empresaA,
        (tx) => tx`
          INSERT INTO settlements (company_id, payable_id, amount_cents, settled_on, bank_account)
          VALUES (${empresaA}, ${conta}, 4200, '2026-09-10', 'Itau')
        `,
      )

      const candidatos = await queries.findCandidates(
        empresaA,
        'payable',
        '2026-09-05',
        '2026-09-15',
      )

      expect(candidatos.map((c) => c.id)).toContain(conta)
    })

    it('traz o bruto E o liquido, e deixa a comparacao para `core`', async () => {
      const recebivel = randomUUID()
      await withTenant(
        sql,
        empresaA,
        (tx) => tx`
          INSERT INTO receivables
            (id, company_id, origin, counterparty, description,
             amount_cents, net_amount_cents, due_date)
          VALUES (${recebivel}, ${empresaA}, 'manual', 'Cartao', 'Venda no credito',
                  10000, 9750, '2026-09-12')
        `,
      )

      const candidatos = await queries.findCandidates(
        empresaA,
        'receivable',
        '2026-09-10',
        '2026-09-14',
      )
      const nosso = candidatos.find((c) => c.id === recebivel)

      /* Os dois numeros sobem. Se o SQL escondesse um COALESCE e devolvesse so
         "o valor certo", a regra sairia de `core` sem nenhum teste de la
         perceber. */
      expect(nosso?.amountCents).toBe(10_000)
      expect(nosso?.netAmountCents).toBe(9_750)
    })

    it('marca como conciliado o que ja tem transacao amarrada', async () => {
      await writer.insertIgnoringDuplicates([transacao(empresaA, { externalId: 'CAND-1' })])
      const tId = await idDaTransacao(empresaA, 'CAND-1')
      const conta = await criarConta(empresaA, 7_700, '2026-09-13')

      const antes = await queries.findCandidates(empresaA, 'payable', '2026-09-13', '2026-09-13')
      expect(antes.find((c) => c.id === conta)?.reconciled).toBe(false)

      await uow.transaction(empresaA, (tx) => tx.link(empresaA, tId, 'payable', conta, AGORA))

      const depois = await queries.findCandidates(empresaA, 'payable', '2026-09-13', '2026-09-13')
      expect(depois.find((c) => c.id === conta)?.reconciled).toBe(true)
    })

    it('a data volta como o dia do banco, sem recuar por fuso', async () => {
      await writer.insertIgnoringDuplicates([
        transacao(empresaA, { externalId: 'DIA-1', postedOn: '2026-09-01' }),
      ])

      const fila = await queries.listTransactions(empresaA, 'pending')
      const nossa = fila.find((t) => t.externalId === 'DIA-1')

      /* `toISOString()` sobre o `Date` de uma coluna `date` recuaria para
         2026-08-31 em fuso negativo — e a data e metade do criterio. */
      expect(nossa?.postedOn).toBe('2026-09-01')
    })
  })

  describe('isolamento entre lojas', () => {
    it('a fila de uma loja nao mostra o extrato da outra', async () => {
      await writer.insertIgnoringDuplicates([
        transacao(empresaB, { externalId: 'SO-DA-B', postedOn: '2026-09-05' }),
      ])

      const daA = await queries.listTransactions(empresaA, 'pending')

      expect(daA.map((t) => t.externalId)).not.toContain('SO-DA-B')
    })

    it('nao acha candidato da outra loja', async () => {
      const contaB = await criarConta(empresaB, 4_321, '2026-09-10')

      const daA = await queries.findCandidates(empresaA, 'payable', '2026-09-10', '2026-09-10')

      expect(daA.map((c) => c.id)).not.toContain(contaB)
    })
  })
})
