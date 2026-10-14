import { pedir, type Resultado } from './http'

/** Caixa — NR-157. Valores em CENTAVOS, como a api. */

export type FormaDoCaixa = 'cash' | 'pix' | 'debit' | 'credit' | 'wallet'

export type SessaoDeCaixa = {
  id: string
  status: 'open' | 'closed'
  openingCents: number
  openedAt: string
  closedAt: string | null
  expectedCents: number | null
  countedCents: number | null
  notes: string | null
}

export type MovimentoDeCaixa = {
  id: string
  kind: 'withdrawal' | 'deposit'
  amountCents: number
  reason: string
  createdAt: string
}

export type ResumoDoCaixa = {
  session: SessaoDeCaixa
  movements: MovimentoDeCaixa[]
  salesByMethod: { method: FormaDoCaixa; amountCents: number }[]
  salesCount: number
  depositsCents: number
  withdrawalsCents: number
  expectedCashCents: number
}

export const ROTULO_FORMA: Record<FormaDoCaixa, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  debit: 'Débito',
  credit: 'Crédito',
  wallet: 'Carteira',
}

export const carregarCaixa = async (): Promise<Resultado<ResumoDoCaixa | null>> => {
  const r = await pedir<{ current: ResumoDoCaixa | null }>('/api/caixa')
  return r.ok ? { ok: true, dados: r.dados.current } : r
}

export const carregarHistoricoDoCaixa = async (): Promise<Resultado<SessaoDeCaixa[]>> => {
  const r = await pedir<{ sessions: SessaoDeCaixa[] }>('/api/caixa/historico')
  return r.ok ? { ok: true, dados: r.dados.sessions } : r
}

export const abrirCaixa = (openingCents: number): Promise<Resultado<ResumoDoCaixa>> =>
  pedir('/api/caixa/abrir', { method: 'POST', body: JSON.stringify({ openingCents }) })

export const movimentarCaixa = (
  kind: 'withdrawal' | 'deposit',
  amountCents: number,
  reason: string,
): Promise<Resultado<MovimentoDeCaixa>> =>
  pedir('/api/caixa/movimentos', {
    method: 'POST',
    body: JSON.stringify({ kind, amountCents, reason: reason.trim() }),
  })

export const fecharCaixa = (
  countedCents: number,
  notes: string,
): Promise<Resultado<ResumoDoCaixa>> =>
  pedir('/api/caixa/fechar', {
    method: 'POST',
    body: JSON.stringify({ countedCents, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
  })
