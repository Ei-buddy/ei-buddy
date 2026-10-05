import { chamarApi } from './api'

/**
 * Contas bancarias da loja — RF-073, as mesmas rotas do web.
 *
 * O saldo e o inicial mais as baixas lancadas em cada conta; quem soma e o
 * servidor.
 */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

export type ContaBancaria = {
  id: string
  name: string
  bank: string | null
  agency: string | null
  accountNumber: string | null
  openingBalanceCents: number
  openingDate: string
  balanceCents: number
}

export async function listarContasBancarias(): Promise<Resultado<ContaBancaria[]>> {
  const r = await chamarApi<{ accounts: ContaBancaria[] }>('/contas-bancarias')
  return r.ok ? { ok: true, dados: r.dados.accounts } : { ok: false, erro: r.message }
}

export async function cadastrarContaBancaria(entrada: {
  name: string
  bank?: string
  agency?: string
  accountNumber?: string
  openingBalanceCents: number
  openingDate: string
}): Promise<Resultado<ContaBancaria>> {
  const r = await chamarApi<ContaBancaria>('/contas-bancarias', { method: 'POST', body: entrada })
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

export async function excluirContaBancaria(id: string): Promise<Resultado<null>> {
  const r = await chamarApi<unknown>(`/contas-bancarias/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  return r.ok ? { ok: true, dados: null } : { ok: false, erro: r.message }
}
