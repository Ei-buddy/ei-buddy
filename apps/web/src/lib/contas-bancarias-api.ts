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

export type DadosContaBancaria = {
  name: string
  bank?: string
  agency?: string
  accountNumber?: string
  openingBalanceCents: number
  openingDate: string
}

export const cadastrarContaBancaria = (
  entrada: DadosContaBancaria,
): Promise<Resultado<ContaBancaria>> =>
  pedir<ContaBancaria>('/api/contas-bancarias', { method: 'POST', body: JSON.stringify(entrada) })

export const excluirContaBancaria = (id: string): Promise<Resultado<unknown>> =>
  pedir(`/api/contas-bancarias/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** Editar — NR-152. O formulario inteiro; renomear mantem o saldo. */
export const editarContaBancaria = (
  id: string,
  entrada: DadosContaBancaria,
): Promise<Resultado<ContaBancaria>> =>
  pedir<ContaBancaria>(`/api/contas-bancarias/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(entrada),
  })
