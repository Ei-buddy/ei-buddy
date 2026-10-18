import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '../context.js'
import { settledInMonth } from './settled-in-month.js'

const contexto = (now: string): ExecutionContext => ({
  companyId: 'emp-1',
  userId: 'usr-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: new Date(now),
})

describe('quitado no mes — o periodo', () => {
  /* 23h de 31/12 em Brasilia ja e 1/1 em UTC: o mes e o da loja. */
  it('usa o mes do fuso da loja, do dia 1 ao ultimo dia', async () => {
    let periodo: string[] = []
    const deps = {
      timeZone: 'America/Sao_Paulo',
      settlementTotals: {
        totalBetween: async (
          _c: string,
          _k: 'payable' | 'receivable',
          from: string,
          to: string,
        ) => {
          periodo = [from, to]
          return { totalCents: 0, count: 0 }
        },
      },
    }

    await settledInMonth(deps, contexto('2027-01-01T02:00:00Z'), 'receivable')

    expect(periodo).toEqual(['2026-12-01', '2026-12-31'])
  })
})
