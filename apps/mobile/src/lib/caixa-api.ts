import { chamarApi } from './api'

/** Caixa — NR-157, as mesmas rotas do web. Valores em CENTAVOS. */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

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

const resultado = <T>(r: { ok: true; dados: T } | { ok: false; message: string }): Resultado<T> =>
  r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }

export async function carregarCaixa(): Promise<Resultado<ResumoDoCaixa | null>> {
  const r = await chamarApi<{ current: ResumoDoCaixa | null }>('/caixa')
  return r.ok ? { ok: true, dados: r.dados.current } : { ok: false, erro: r.message }
}

export async function carregarHistoricoDoCaixa(): Promise<Resultado<SessaoDeCaixa[]>> {
  const r = await chamarApi<{ sessions: SessaoDeCaixa[] }>('/caixa/historico')
  return r.ok ? { ok: true, dados: r.dados.sessions } : { ok: false, erro: r.message }
}

export const abrirCaixa = async (openingCents: number) =>
  resultado(
    await chamarApi<ResumoDoCaixa>('/caixa/abrir', { method: 'POST', body: { openingCents } }),
  )

export const movimentarCaixa = async (
  kind: 'withdrawal' | 'deposit',
  amountCents: number,
  reason: string,
) =>
  resultado(
    await chamarApi<MovimentoDeCaixa>('/caixa/movimentos', {
      method: 'POST',
      body: { kind, amountCents, reason: reason.trim() },
    }),
  )

export const fecharCaixa = async (countedCents: number, notes: string) =>
  resultado(
    await chamarApi<ResumoDoCaixa>('/caixa/fechar', {
      method: 'POST',
      body: { countedCents, ...(notes.trim() ? { notes: notes.trim() } : {}) },
    }),
  )
