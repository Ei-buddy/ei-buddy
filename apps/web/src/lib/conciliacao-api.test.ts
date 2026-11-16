import { describe, expect, it } from 'vitest'
import {
  paresMarcados,
  resumoDaConfirmacao,
  semDuvida,
  type ParAutomatico,
} from './conciliacao-api'

/** Conciliar da baixa na tela — DEC-026 (NR-225). */

const par = (
  id: string,
  sugestao: { entryId: string; daysApart: number; alternatives: number } | null,
): ParAutomatico => ({
  transaction: {
    id,
    externalId: `F-${id}`,
    direction: 'debit',
    amountCents: 100,
    postedOn: '2026-11-01',
    description: id,
    counterparty: null,
    reconciledEntryKind: null,
    reconciledEntryId: null,
    settlementId: null,
  },
  suggestion:
    sugestao === null
      ? null
      : {
          entry: {
            kind: 'payable',
            id: sugestao.entryId,
            counterparty: 'X',
            description: 'Y',
            dueDate: '2026-11-01',
            amountCents: 100,
            netAmountCents: null,
          },
          expectedAmountCents: 100,
          daysApart: sugestao.daysApart,
          confidencePoints: 100,
          alternatives: sugestao.alternatives,
        },
})

describe('pares confirmados', () => {
  const pares = [
    par('t1', { entryId: 'c1', daysApart: 0, alternatives: 0 }),
    par('t2', null),
    par('t3', { entryId: 'c3', daysApart: 2, alternatives: 0 }),
    par('t4', { entryId: 'c4', daysApart: 0, alternatives: 1 }),
  ]

  it('so os marcados que tem lancamento, na ordem do extrato (a da lista)', () => {
    expect(paresMarcados(pares, new Set(['t4', 't2', 't1']))).toEqual([
      { transactionId: 't1', entryKind: 'payable', entryId: 'c1' },
      { transactionId: 't4', entryKind: 'payable', entryId: 'c4' },
    ])
  })

  it('"sem duvida" e mesmo dia E nenhum outro do mesmo valor', () => {
    expect(pares.filter(semDuvida).map((p) => p.transaction.id)).toEqual(['t1'])
  })
})

describe('resumo da confirmacao', () => {
  const ordem = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      transactionId: `t${i}`,
      entryKind: 'payable' as const,
      entryId: `c${i}`,
      postedOn: '2026-11-01',
      amountCents: 100,
      settlementId: `s${i}`,
    }))

  it('todas baixadas; e quando parte ja estava quitada', () => {
    expect(resumoDaConfirmacao({ reconciled: 3, settled: 3, order: ordem(3) })).toBe(
      '3 linhas conciliadas e baixadas, na ordem do extrato.',
    )
    expect(resumoDaConfirmacao({ reconciled: 1, settled: 1, order: ordem(1) })).toBe(
      '1 linha conciliada e baixada, na ordem do extrato.',
    )
    expect(resumoDaConfirmacao({ reconciled: 3, settled: 2, order: ordem(3) })).toBe(
      '3 linhas conciliadas: 2 baixas lançadas na ordem do extrato, 1 já estava quitada.',
    )
  })
})
