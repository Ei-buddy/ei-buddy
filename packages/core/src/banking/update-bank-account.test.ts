import type { BankAccountOutput } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import type { BankAccountRepository } from '../ports/bank-account-repository.js'
import { updateBankAccount } from './manage-bank-accounts.js'

/** Editar conta bancaria — NR-152. A regra do nome em uso e do banco. */

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  companyId: 'emp-1',
  userId: 'usr-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: new Date('2026-09-02T12:00:00.000Z'),
  ...over,
})

function repo(contas: BankAccountOutput[]): BankAccountRepository {
  return {
    list: async () => contas,
    findById: async (empresa, id) =>
      empresa === 'emp-1' ? contas.find((c) => c.id === id) : undefined,
    insert: async () => undefined,
    remove: async () => undefined,
    update: async (_e, id, m) => {
      if (contas.some((c) => c.id !== id && c.name.toLowerCase() === m.name.toLowerCase())) {
        return 'nome_em_uso'
      }
      const i = contas.findIndex((c) => c.id === id)
      contas[i] = { ...contas[i]!, ...m }
      return contas[i]!
    },
  }
}

const conta = (id: string, name: string): BankAccountOutput => ({
  id,
  name,
  bank: null,
  agency: null,
  accountNumber: null,
  openingBalanceCents: 0,
  openingDate: '2026-01-01',
  balanceCents: 0,
})

const entrada = { name: 'Nubank PJ', openingBalanceCents: 5_000, openingDate: '2026-01-01' }

describe('editar conta bancaria — NR-152', () => {
  it('grava e deixa rastro com antes e depois', async () => {
    const audit = new InMemoryAuditTrail()
    const d = { bankAccounts: repo([conta('c1', 'Nubank')]), audit }

    const r = await updateBankAccount(d, ctx(), 'c1', entrada)

    expect(r.name).toBe('Nubank PJ')
    expect(audit.daEmpresa('emp-1')[0]).toMatchObject({
      action: 'updated',
      before: { name: 'Nubank' },
      after: { name: 'Nubank PJ', openingBalanceCents: 5_000 },
    })
  })

  it('nome de outra conta e conflito', async () => {
    const d = {
      bankAccounts: repo([conta('c1', 'Nubank'), conta('c2', 'Nubank PJ')]),
      audit: new InMemoryAuditTrail(),
    }

    const erro = await updateBankAccount(d, ctx(), 'c1', entrada).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
  })

  it('de outra empresa responde NOT_FOUND', async () => {
    const d = { bankAccounts: repo([conta('c1', 'Nubank')]), audit: new InMemoryAuditTrail() }

    const erro = await updateBankAccount(d, ctx({ companyId: 'emp-2' }), 'c1', entrada).catch(
      (e) => e,
    )

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})
