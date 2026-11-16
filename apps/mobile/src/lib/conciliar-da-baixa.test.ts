import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Conciliar da baixa no app — DEC-026, as mesmas regras e rotas do web. */

const chamadas: { caminho: string; opcoes?: { method?: string; body?: unknown } }[] = []
let resposta: { ok: boolean; dados?: unknown; status?: number; code?: string; message?: string }

vi.mock('./api', () => ({
  chamarApi: vi.fn((caminho: string, opcoes?: { method?: string; body?: unknown }) => {
    chamadas.push({ caminho, ...(opcoes ? { opcoes } : {}) })
    return Promise.resolve(resposta)
  }),
}))

const {
  carregarCasamentoAutomatico,
  conciliar,
  confirmarConciliacoes,
  paresMarcados,
  resumoDaConfirmacao,
  semDuvida,
} = await import('./conciliacao-api.js')

type Par = Parameters<typeof paresMarcados>[0][number]

const par = (
  id: string,
  s: { entryId: string; daysApart: number; alternatives: number } | null,
): Par => ({
  transaction: {
    id,
    direction: 'debit',
    amountCents: 100,
    postedOn: '2026-11-01',
    description: id,
    counterparty: null,
  },
  suggestion:
    s === null
      ? null
      : {
          entry: {
            kind: 'payable',
            id: s.entryId,
            counterparty: 'X',
            description: 'Y',
            dueDate: '2026-11-01',
            amountCents: 100,
            netAmountCents: null,
          },
          expectedAmountCents: 100,
          daysApart: s.daysApart,
          confidencePoints: 100,
          alternatives: s.alternatives,
        },
})

beforeEach(() => {
  chamadas.length = 0
})

describe('rotas', () => {
  it('casa, confirma com a conta e concilia um par com a conta', async () => {
    resposta = { ok: true, dados: { pairs: [] } }
    await carregarCasamentoAutomatico()
    resposta = { ok: true, dados: { reconciled: 1, settled: 1, order: [] } }
    await confirmarConciliacoes('Nubank PJ', [
      { transactionId: 't1', entryKind: 'payable', entryId: 'c1' },
    ])
    await conciliar('t2', { entryKind: 'payable', entryId: 'c2', bankAccount: 'Nubank PJ' })

    expect(chamadas.map((c) => [c.caminho, c.opcoes?.method ?? 'GET'])).toEqual([
      ['/conciliacao/automatica', 'GET'],
      ['/conciliacao/confirmar', 'POST'],
      ['/conciliacao/transacoes/t2/conciliar', 'POST'],
    ])
    expect(chamadas[1]?.opcoes?.body).toEqual({
      bankAccount: 'Nubank PJ',
      pairs: [{ transactionId: 't1', entryKind: 'payable', entryId: 'c1' }],
    })
    expect(chamadas[2]?.opcoes?.body).toMatchObject({ bankAccount: 'Nubank PJ' })
  })

  it('erro da api vira a mensagem', async () => {
    resposta = {
      ok: false,
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Linha 02/11: nao bate',
    }
    expect(
      await confirmarConciliacoes('X', [
        { transactionId: 't', entryKind: 'payable', entryId: 'c' },
      ]),
    ).toEqual({
      ok: false,
      erro: 'Linha 02/11: nao bate',
    })
  })
})

describe('pares — as mesmas regras do web', () => {
  const pares = [
    par('t1', { entryId: 'c1', daysApart: 0, alternatives: 0 }),
    par('t2', null),
    par('t3', { entryId: 'c3', daysApart: 0, alternatives: 2 }),
  ]

  it('marcados com lancamento, na ordem da lista; sem duvida e so mesmo dia e sem concorrente', () => {
    expect(paresMarcados(pares, new Set(['t3', 't2', 't1'])).map((p) => p.transactionId)).toEqual([
      't1',
      't3',
    ])
    expect(pares.filter(semDuvida).map((p) => p.transaction.id)).toEqual(['t1'])
  })

  it('resumo', () => {
    expect(resumoDaConfirmacao({ reconciled: 2, settled: 1, order: [] })).toBe(
      '2 linhas conciliadas: 1 baixa lançada na ordem do extrato, 1 já estava quitada.',
    )
  })
})
