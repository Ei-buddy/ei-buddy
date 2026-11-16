import { randomUUID } from 'node:crypto'
import {
  autoMatch,
  confirmReconciliations,
  undoReconciliation,
  type ExecutionContext,
} from '@na-regua/core'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createBankTransactionWriter,
  createConciliacaoComBaixaUnitOfWork,
  createReconciliationQueries,
  createReconciliationUnitOfWork,
} from './bank-transaction-repository.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Conciliar da baixa no banco — DEC-026 (NR-225).
 *
 * As regras tem teste em `core`. Aqui, o que so o Postgres prova: a ordem do
 * extrato vem da posicao no arquivo (e nao do uuid), a conciliacao e a baixa
 * entram NA MESMA transacao (falha no meio nao deixa meia baixa), e o desfazer
 * estorna a baixa certa.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('conciliar da baixa — NR-225', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string
  let usuario: string
  let deps: Parameters<typeof confirmReconciliations>[0]

  const AGORA = new Date('2026-11-16T12:00:00.000Z')
  const ctx = (): ExecutionContext => ({
    companyId: empresa,
    userId: usuario,
    role: 'owner',
    channel: 'app',
    requestId: 'req',
    now: AGORA,
  })

  async function conta(valor: number, vencimento: string, fornecedor = 'Copel'): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO payables (id, company_id, supplier, description, amount_cents, due_date)
        VALUES (${id}, ${empresa}, ${fornecedor}, 'Conta', ${valor}, ${vencimento})
      `,
    )
    return id
  }

  const extrato = (linhas: { id: string; valor: number; dia: string; texto?: string }[]) =>
    createBankTransactionWriter(sql).insertIgnoringDuplicates(
      linhas.map((l) => ({
        companyId: empresa,
        externalId: l.id,
        direction: 'debit' as const,
        amountCents: l.valor,
        postedOn: l.dia,
        description: l.texto ?? l.id,
        counterparty: null,
        importedBy: usuario,
        importedAt: AGORA,
      })),
    )

  const titulo = async (id: string) => {
    const [l] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ settled_amount_cents: string; status: string }[]>`
        SELECT settled_amount_cents, status FROM payables WHERE id = ${id}
      `,
    )
    return { settled: Number(l!.settled_amount_cents), status: l!.status }
  }

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresa = randomUUID()
    const cnpj = cnpjDeTeste('9')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, 'Loja Conciliacao', ${cnpj}, ${`k@${cnpj}.local`}, '41999990000')
      `,
    )
    usuario = randomUUID()
    await admin`INSERT INTO users (id, name, email) VALUES (${usuario}, 'Dona', ${`u${usuario}@local`})`

    const recon = createReconciliationUnitOfWork(sql)
    deps = {
      uow: recon,
      queries: createReconciliationQueries(sql),
      baixas: createConciliacaoComBaixaUnitOfWork(sql),
    }
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  it('a fila segue a ordem do ARQUIVO no mesmo dia, e as baixas saem nela', async () => {
    /* No mesmo dia, de proposito: so a posicao no arquivo ordena. */
    await extrato([
      { id: 'ORD-C', valor: 301, dia: '2026-11-03', texto: 'terceira' },
      { id: 'ORD-A', valor: 101, dia: '2026-11-03', texto: 'primeira?' },
      { id: 'ORD-B', valor: 201, dia: '2026-11-03', texto: 'segunda?' },
    ])
    const c1 = await conta(301, '2026-11-03')
    const c2 = await conta(101, '2026-11-03')
    const c3 = await conta(201, '2026-11-03')

    const { pairs } = await autoMatch(deps, ctx())
    const nossas = pairs.filter((p) => p.transaction.externalId.startsWith('ORD-'))
    expect(nossas.map((p) => p.transaction.externalId)).toEqual(['ORD-C', 'ORD-A', 'ORD-B'])
    expect(nossas.map((p) => p.suggestion?.entry.id)).toEqual([c1, c2, c3])

    const r = await confirmReconciliations(deps, ctx(), {
      bankAccount: 'Nubank PJ',
      /* Chegando fora de ordem. */
      pairs: [...nossas].reverse().map((p) => ({
        transactionId: p.transaction.id,
        entryKind: 'payable' as const,
        entryId: p.suggestion!.entry.id,
      })),
    })
    expect(r.order.map((o) => o.amountCents)).toEqual([301, 101, 201])
    expect(r.settled).toBe(3)

    /* E as baixas foram gravadas nessa ordem. */
    const baixas = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ amount_cents: string; bank_account: string; settled_on: Date }[]>`
        SELECT s.amount_cents, s.bank_account, s.settled_on
          FROM settlements s JOIN bank_transactions b ON b.settlement_id = s.id
         WHERE b.external_id LIKE 'ORD-%'
         ORDER BY s.created_at, s.id
      `,
    )
    expect(baixas.map((b) => Number(b.amount_cents)).sort()).toEqual([101, 201, 301])
    expect(new Set(baixas.map((b) => b.bank_account))).toEqual(new Set(['Nubank PJ']))
    expect(await titulo(c1)).toEqual({ settled: 301, status: 'settled' })
  })

  it('falha no meio do lote: nada fica — nem vinculo, nem baixa', async () => {
    await extrato([
      { id: 'LOTE-1', valor: 1_111, dia: '2026-11-05' },
      { id: 'LOTE-2', valor: 2_222, dia: '2026-11-05' },
    ])
    const boa = await conta(1_111, '2026-11-05')
    const ruim = await conta(2_000, '2026-11-05')
    const { pairs } = await autoMatch(deps, ctx())
    const id = (ext: string) => pairs.find((p) => p.transaction.externalId === ext)!.transaction.id

    await expect(
      confirmReconciliations(deps, ctx(), {
        bankAccount: 'Nubank PJ',
        pairs: [
          { transactionId: id('LOTE-1'), entryKind: 'payable', entryId: boa },
          { transactionId: id('LOTE-2'), entryKind: 'payable', entryId: ruim },
        ],
      }),
    ).rejects.toThrow(/O banco mostra R\$ 22,22/)

    expect(await titulo(boa)).toEqual({ settled: 0, status: 'open' })
    const [linha] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ reconciled_at: Date | null; settlement_id: string | null }[]>`
        SELECT reconciled_at, settlement_id FROM bank_transactions WHERE external_id = 'LOTE-1'
      `,
    )
    expect(linha).toEqual({ reconciled_at: null, settlement_id: null })
  })

  it('desfazer estorna a baixa da conciliacao e devolve a conta para aberta', async () => {
    await extrato([{ id: 'DESF-1', valor: 4_800, dia: '2026-11-10' }])
    const c = await conta(4_800, '2026-11-10')
    const { pairs } = await autoMatch(deps, ctx())
    const t = pairs.find((p) => p.transaction.externalId === 'DESF-1')!.transaction

    await confirmReconciliations(deps, ctx(), {
      bankAccount: 'Nubank PJ',
      pairs: [{ transactionId: t.id, entryKind: 'payable', entryId: c }],
    })
    expect((await titulo(c)).status).toBe('settled')

    await undoReconciliation(deps, ctx(), { transactionId: t.id, reason: 'conta errada' })

    expect(await titulo(c)).toEqual({ settled: 0, status: 'open' })
    const linhas = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ amount_cents: string; notes: string | null }[]>`
        SELECT amount_cents, notes FROM settlements WHERE payable_id = ${c} ORDER BY created_at, amount_cents DESC
      `,
    )
    expect(linhas.map((l) => Number(l.amount_cents))).toEqual([4_800, -4_800])
    expect(linhas[1]!.notes).toBe('Conciliação desfeita: conta errada')
  })

  it('baixa da conciliacao so existe em linha conciliada (CHECK do banco)', async () => {
    await extrato([{ id: 'CHK-1', valor: 999, dia: '2026-11-11' }])
    await expect(
      withTenant(
        sql,
        empresa,
        (tx) => tx`
          UPDATE bank_transactions
             SET settlement_id = (SELECT id FROM settlements LIMIT 1)
           WHERE external_id = 'CHK-1'
        `,
      ),
    ).rejects.toThrow(/bank_transactions_baixa_so_conciliada/)
  })
})
