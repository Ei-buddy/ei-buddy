import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { InMemorySettlements } from '../settlements/fakes.js'
import { autoMatch, confirmReconciliations } from './confirm.js'
import { InMemoryConciliacaoComBaixa, InMemoryReconciliation } from './fakes.js'
import { createEntryFromTransaction, reconcile, undoReconciliation } from './reconcile.js'

/**
 * Conciliar da baixa — DEC-026 (decisao de 15/11).
 *
 * O extrato casa sozinho com as contas, a pessoa confirma os pares lado a
 * lado, e o sistema da baixa em tudo o que foi confirmado, NA ORDEM DO
 * EXTRATO.
 */

const AGORA = new Date('2026-11-16T12:00:00.000Z')
const EMPRESA = 'empresa-1'
const CONTA = 'Nubank PJ'

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  companyId: EMPRESA,
  userId: 'usuario-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: AGORA,
  ...over,
})

function cenario() {
  const trilha = new InMemoryAuditTrail()
  const repo = new InMemoryReconciliation(trilha)
  const baixas = new InMemorySettlements(trilha)
  const combinado = new InMemoryConciliacaoComBaixa(repo, baixas)
  const bankAccounts = {
    list: async () => [{ id: 'cb-1', name: CONTA }] as never,
  }
  return {
    deps: { uow: repo, queries: repo, baixas: combinado, bankAccounts },
    repo,
    baixas,
    combinado,
    trilha,
  }
}

async function erroDe(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}

describe('casamento automatico — DEC-026, passo 2', () => {
  it('casa a fila inteira, na ordem do extrato, e deixa sem par o que nao bate', async () => {
    const { deps, repo, combinado } = cenario()
    const luz = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 48_000,
      postedOn: '2026-11-10',
      description: 'DEB COPEL',
    })
    const pix = repo.adicionarTransacao(EMPRESA, {
      direction: 'credit',
      amountCents: 12_000,
      postedOn: '2026-11-03',
      description: 'PIX MARIA',
    })
    const tarifa = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 1_290,
      postedOn: '2026-11-05',
      description: 'TARIFA',
    })
    combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'Copel',
      amountCents: 48_000,
      dueDate: '2026-11-10',
    })
    combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'receivable',
      counterparty: 'Maria',
      amountCents: 12_000,
      dueDate: '2026-11-04',
    })

    const { pairs } = await autoMatch(deps, ctx())

    /* Ordem do extrato: dia 3, dia 5, dia 10. */
    expect(pairs.map((p) => p.transaction.id)).toEqual([pix.id, tarifa.id, luz.id])
    expect(pairs[0]!.suggestion).toMatchObject({ entry: { counterparty: 'Maria' }, daysApart: 1 })
    expect(pairs[1]!.suggestion).toBeNull()
    expect(pairs[2]!.suggestion).toMatchObject({
      entry: { counterparty: 'Copel' },
      confidencePoints: 100,
      alternatives: 0,
    })
  })

  it('duas linhas e duas contas de mesmo valor: cada linha fica com a conta da sua data', async () => {
    const { deps, repo, combinado } = cenario()
    const dia20 = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 48_000,
      postedOn: '2026-11-20',
    })
    const dia10 = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 48_000,
      postedOn: '2026-11-10',
    })
    const conta10 = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'Aluguel A',
      amountCents: 48_000,
      dueDate: '2026-11-10',
    })
    const conta20 = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'Aluguel B',
      amountCents: 48_000,
      dueDate: '2026-11-20',
    })

    const { pairs } = await autoMatch(deps, ctx())
    const de = (id: string) => pairs.find((p) => p.transaction.id === id)!.suggestion!.entry.id
    expect(de(dia10.id)).toBe(conta10.id)
    expect(de(dia20.id)).toBe(conta20.id)
  })

  it('um lancamento nao e oferecido para duas linhas', async () => {
    const { deps, repo, combinado } = cenario()
    repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-11-10',
    })
    repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-11-11',
    })
    combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'Unica',
      amountCents: 5_000,
      dueDate: '2026-11-10',
    })

    const { pairs } = await autoMatch(deps, ctx())
    expect(pairs.filter((p) => p.suggestion !== null)).toHaveLength(1)
    expect(pairs[0]!.suggestion?.entry.counterparty).toBe('Unica')
  })
})

describe('confirmar da baixa — DEC-026, passos 4 e 5', () => {
  it('concilia e baixa cada par, na data do banco e na conta do extrato', async () => {
    const { deps, repo, baixas, combinado } = cenario()
    const t = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 48_000,
      postedOn: '2026-11-12',
      description: 'DEB COPEL',
    })
    const conta = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'Copel',
      amountCents: 48_000,
      dueDate: '2026-11-10',
    })

    const r = await confirmReconciliations(deps, ctx(), {
      bankAccount: 'nubank pj',
      pairs: [{ transactionId: t.id, entryKind: 'payable', entryId: conta.id }],
    })

    expect(r).toMatchObject({ reconciled: 1, settled: 1 })
    expect(baixas.tituloDe(conta.id)).toMatchObject({
      settledAmountCents: 48_000,
      status: 'settled',
    })
    expect(repo.transacao(t.id)).toMatchObject({
      reconciledEntryId: conta.id,
      settlementId: r.order[0]!.settlementId,
    })
    expect(r.order[0]!.settlementId).not.toBeNull()
  })

  it('as baixas saem na ORDEM DO EXTRATO, e nao na ordem em que os pares chegaram', async () => {
    const { deps, repo, combinado } = cenario()
    const t3 = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 300,
      postedOn: '2026-11-03',
    })
    const t1 = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 100,
      postedOn: '2026-11-01',
    })
    const t2 = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 200,
      postedOn: '2026-11-02',
    })
    const c1 = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'A',
      amountCents: 100,
      dueDate: '2026-11-01',
    })
    const c2 = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'B',
      amountCents: 200,
      dueDate: '2026-11-02',
    })
    const c3 = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'C',
      amountCents: 300,
      dueDate: '2026-11-03',
    })

    const r = await confirmReconciliations(deps, ctx(), {
      bankAccount: CONTA,
      pairs: [
        { transactionId: t3.id, entryKind: 'payable', entryId: c3.id },
        { transactionId: t1.id, entryKind: 'payable', entryId: c1.id },
        { transactionId: t2.id, entryKind: 'payable', entryId: c2.id },
      ],
    })
    expect(r.order.map((o) => o.postedOn)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
  })

  it('titulo ja quitado (recebivel do cartao) so e ligado; baixa parcial recebe o restante', async () => {
    const { deps, repo, baixas, combinado } = cenario()
    const cartao = repo.adicionarTransacao(EMPRESA, {
      direction: 'credit',
      amountCents: 9_700,
      postedOn: '2026-11-12',
    })
    const fiado = repo.adicionarTransacao(EMPRESA, {
      direction: 'credit',
      amountCents: 5_000,
      postedOn: '2026-11-13',
    })
    const rCartao = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'receivable',
      counterparty: 'Venda 12',
      amountCents: 10_000,
      netAmountCents: 9_700,
      settledAmountCents: 10_000,
      status: 'settled',
      dueDate: '2026-11-12',
    })
    const rFiado = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'receivable',
      counterparty: 'Joao',
      amountCents: 5_000,
      settledAmountCents: 2_000,
      status: 'partially_settled',
      dueDate: '2026-11-13',
    })

    const r = await confirmReconciliations(deps, ctx(), {
      bankAccount: CONTA,
      pairs: [
        { transactionId: cartao.id, entryKind: 'receivable', entryId: rCartao.id },
        { transactionId: fiado.id, entryKind: 'receivable', entryId: rFiado.id },
      ],
    })
    expect(r).toMatchObject({ reconciled: 2, settled: 1 })
    expect(r.order[0]!.settlementId).toBeNull()
    expect(baixas.tituloDe(rCartao.id)?.settledAmountCents).toBe(10_000)
    expect(baixas.tituloDe(rFiado.id)).toMatchObject({
      settledAmountCents: 5_000,
      status: 'settled',
    })
  })

  it('um par que nao fecha recusa o lote INTEIRO e diz qual linha', async () => {
    const { deps, repo, baixas, combinado, trilha } = cenario()
    const boa = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 1_000,
      postedOn: '2026-11-01',
      description: 'BOA',
    })
    const ruim = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 2_500,
      postedOn: '2026-11-02',
      description: 'DIFERENTE',
    })
    const c1 = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'A',
      amountCents: 1_000,
      dueDate: '2026-11-01',
    })
    const c2 = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'B',
      amountCents: 2_000,
      dueDate: '2026-11-02',
    })
    const trilhaAntes = trilha.total

    const erro = await erroDe(() =>
      confirmReconciliations(deps, ctx(), {
        bankAccount: CONTA,
        pairs: [
          { transactionId: boa.id, entryKind: 'payable', entryId: c1.id },
          { transactionId: ruim.id, entryKind: 'payable', entryId: c2.id },
        ],
      }),
    )
    expect(isAppError(erro) && erro.message).toMatch(
      /^Linha 02\/11 · DIFERENTE: O banco mostra R\$ 25,00/,
    )
    /* Nada ficou: nem o vinculo, nem a baixa, nem a trilha do primeiro par. */
    expect(repo.transacao(boa.id)?.reconciledEntryId).toBeNull()
    expect(baixas.tituloDe(c1.id)?.settledAmountCents).toBe(0)
    expect(baixas.totalDeBaixas).toBe(0)
    expect(trilha.total).toBe(trilhaAntes)
  })

  it('conta que nao e da loja e recusada; contador nao confirma', async () => {
    const { deps, repo, combinado } = cenario()
    const t = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 1_000,
      postedOn: '2026-11-01',
    })
    const c = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'A',
      amountCents: 1_000,
      dueDate: '2026-11-01',
    })
    const pares = [{ transactionId: t.id, entryKind: 'payable' as const, entryId: c.id }]

    const semConta = await erroDe(() =>
      confirmReconciliations(deps, ctx(), { bankAccount: 'Banco X', pairs: pares }),
    )
    expect(isAppError(semConta) && semConta.code).toBe('VALIDATION_FAILED')

    const contador = await erroDe(() =>
      confirmReconciliations(deps, ctx({ role: 'accountant' }), {
        bankAccount: CONTA,
        pairs: pares,
      }),
    )
    expect(isAppError(contador) && contador.code).toBe('FORBIDDEN')
  })
})

describe('os caminhos de um par so tambem dao baixa — DEC-026', () => {
  it('conciliar com a conta da baixa; sem a conta, so liga (como antes)', async () => {
    const { deps, repo, baixas, combinado } = cenario()
    const a = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 700,
      postedOn: '2026-11-01',
    })
    const b = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 800,
      postedOn: '2026-11-01',
    })
    const ca = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'A',
      amountCents: 700,
      dueDate: '2026-11-01',
    })
    const cb = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'B',
      amountCents: 800,
      dueDate: '2026-11-01',
    })

    await reconcile(deps, ctx(), {
      transactionId: a.id,
      entryKind: 'payable',
      entryId: ca.id,
      bankAccount: CONTA,
    })
    await reconcile(deps, ctx(), { transactionId: b.id, entryKind: 'payable', entryId: cb.id })

    expect(baixas.tituloDe(ca.id)?.status).toBe('settled')
    expect(baixas.tituloDe(cb.id)?.status).toBe('open')
    expect(repo.transacao(b.id)?.reconciledEntryId).toBe(cb.id)
  })

  it('o lancamento criado do extrato ja nasce baixado', async () => {
    const { deps, repo, baixas } = cenario()
    const t = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 1_290,
      postedOn: '2026-11-05',
      description: 'TARIFA',
    })

    const r = await createEntryFromTransaction(deps, ctx(), {
      transactionId: t.id,
      counterparty: 'Banco',
      description: 'Tarifa do mês',
      bankAccount: CONTA,
    })
    expect(baixas.tituloDe(r.entryId)).toMatchObject({
      settledAmountCents: 1_290,
      status: 'settled',
    })
    expect(repo.transacao(t.id)?.settlementId).not.toBeNull()
  })

  it('desfazer estorna a baixa da conciliacao, e so ela', async () => {
    const { deps, repo, baixas, combinado } = cenario()
    const t = repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 48_000,
      postedOn: '2026-11-12',
    })
    const c = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'Copel',
      amountCents: 48_000,
      dueDate: '2026-11-10',
    })
    await reconcile(deps, ctx(), {
      transactionId: t.id,
      entryKind: 'payable',
      entryId: c.id,
      bankAccount: CONTA,
    })
    expect(baixas.tituloDe(c.id)?.status).toBe('settled')

    await undoReconciliation(deps, ctx(), { transactionId: t.id, reason: 'era a conta errada' })

    expect(baixas.tituloDe(c.id)).toMatchObject({ settledAmountCents: 0, status: 'open' })
    expect(repo.transacao(t.id)).toMatchObject({ reconciledEntryId: null, settlementId: null })
    /* A baixa e o estorno ficam: o rastro e desejado (RF-067). */
    expect(baixas.totalDeBaixas).toBe(2)
  })

  it('desfazer a conciliacao de titulo ja quitado nao estorna nada', async () => {
    const { deps, repo, baixas, combinado } = cenario()
    const t = repo.adicionarTransacao(EMPRESA, {
      direction: 'credit',
      amountCents: 9_700,
      postedOn: '2026-11-12',
    })
    const r = combinado.adicionarTitulo(EMPRESA, {
      entryKind: 'receivable',
      counterparty: 'Venda',
      amountCents: 10_000,
      netAmountCents: 9_700,
      settledAmountCents: 10_000,
      status: 'settled',
      dueDate: '2026-11-12',
    })
    await reconcile(deps, ctx(), {
      transactionId: t.id,
      entryKind: 'receivable',
      entryId: r.id,
      bankAccount: CONTA,
    })
    await undoReconciliation(deps, ctx(), { transactionId: t.id, reason: 'conferir de novo' })
    expect(baixas.tituloDe(r.id)?.settledAmountCents).toBe(10_000)
    expect(baixas.totalDeBaixas).toBe(0)
  })
})
