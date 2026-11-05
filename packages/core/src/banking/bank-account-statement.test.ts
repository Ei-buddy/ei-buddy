import type { BankAccountOutput } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type { MovimentoDaConta } from '../ports/bank-account-repository.js'
import { getBankAccountStatement } from './bank-account-statement.js'

const ctx: ExecutionContext = {
  companyId: 'emp-1',
  userId: 'u-1',
  role: 'accountant',
  channel: 'app',
  requestId: 'req-1',
  now: new Date('2026-11-05T12:00:00.000Z'),
}

const conta: BankAccountOutput = {
  id: 'c1',
  name: 'Itaú Loja',
  bank: 'Itaú',
  agency: null,
  accountNumber: null,
  openingBalanceCents: 100_000,
  openingDate: '2026-10-01',
  balanceCents: 0,
}

const mov = (id: string, date: string, amountCents: number): MovimentoDaConta => ({
  id,
  date,
  kind: amountCents > 0 ? 'receivable' : 'payable',
  isReversal: false,
  description: `mov ${id}`,
  counterparty: null,
  amountCents,
})

function deps(movimentos: MovimentoDaConta[], antesCents = 0) {
  const pedidos: { from: string; to: string }[] = []
  return {
    pedidos,
    bankAccounts: {
      findById: async (empresa: string, id: string) =>
        empresa === 'emp-1' && id === 'c1' ? conta : undefined,
      statement: async (_e: string, _c: unknown, from: string, to: string) => {
        pedidos.push({ from, to })
        return { antesCents, movimentos }
      },
    },
  }
}

describe('extrato da conta bancaria', () => {
  it('parte do saldo antes do periodo e corre o saldo linha a linha', async () => {
    const d = deps([mov('a', '2026-11-02', 5_000), mov('b', '2026-11-03', -12_000)], 30_000)

    const r = await getBankAccountStatement(d, ctx, 'c1', { from: '2026-11-01', to: '2026-11-30' })

    expect(r.openingCents).toBe(130_000)
    expect(r.entries.map((e) => e.balanceCents)).toEqual([135_000, 123_000])
    expect(r).toMatchObject({ inflowCents: 5_000, outflowCents: 12_000, closingCents: 123_000 })
  })

  it('periodo que comeca antes da abertura comeca na abertura', async () => {
    const d = deps([])

    const r = await getBankAccountStatement(d, ctx, 'c1', { from: '2026-09-01', to: '2026-10-31' })

    expect(d.pedidos).toEqual([{ from: '2026-10-01', to: '2026-10-31' }])
    expect(r.openingCents).toBe(100_000)
  })

  it('periodo inteiro antes da abertura nem consulta: so o saldo inicial', async () => {
    const d = deps([mov('x', '2026-08-02', 1)])

    const r = await getBankAccountStatement(d, ctx, 'c1', { from: '2026-08-01', to: '2026-08-31' })

    expect(d.pedidos).toHaveLength(0)
    expect(r.entries).toEqual([])
    expect(r.closingCents).toBe(100_000)
  })

  it('conta de outra loja e 404, e o contador pode ler', async () => {
    const erro = await getBankAccountStatement(deps([]), { ...ctx, companyId: 'emp-2' }, 'c1', {
      from: '2026-11-01',
      to: '2026-11-30',
    }).catch((e: unknown) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})
