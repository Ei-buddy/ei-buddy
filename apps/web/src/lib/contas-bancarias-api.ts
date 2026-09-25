import { pedir, type Resultado } from './http'

/** Conta bancaria da loja — RF-073. Valores em CENTAVOS, como a api. */
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
  const r = await pedir<{ accounts: ContaBancaria[] }>('/api/contas-bancarias')
  return r.ok ? { ok: true, dados: r.dados.accounts } : r
}

export const cadastrarContaBancaria = (entrada: {
  name: string
  bank?: string
  agency?: string
  accountNumber?: string
  openingBalanceCents: number
  openingDate: string
}): Promise<Resultado<ContaBancaria>> =>
  pedir<ContaBancaria>('/api/contas-bancarias', { method: 'POST', body: JSON.stringify(entrada) })

export const excluirContaBancaria = (id: string): Promise<Resultado<unknown>> =>
  pedir(`/api/contas-bancarias/${encodeURIComponent(id)}`, { method: 'DELETE' })
