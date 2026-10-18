import { chamarApi } from './api'

/**
 * Conciliacao bancaria — RF-074 a RF-078, as mesmas rotas do web.
 *
 * Importa o extrato (OFX ou CSV), mostra a fila do que ainda nao bateu, sugere
 * o lancamento correspondente e concilia; o que nao tem lancamento vira um.
 */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

async function pedir<T>(
  caminho: string,
  opcoes: { method?: string; body?: unknown } = {},
): Promise<Resultado<T>> {
  const r = await chamarApi<T>(caminho, opcoes)
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

export type TipoDeLancamento = 'payable' | 'receivable'

export type TransacaoBancaria = {
  id: string
  direction: 'debit' | 'credit'
  amountCents: number
  postedOn: string
  description: string
  counterparty: string | null
  reconciledWith: {
    kind: TipoDeLancamento
    id: string
    counterparty: string
    description: string
    dueDate: string
  } | null
}

export type Sugestao = {
  entry: {
    entryKind: TipoDeLancamento
    id: string
    counterparty: string
    description: string
    amountCents: number
    dueDate: string
  }
  daysApart: number
  confidencePoints: number
  expectedAmountCents: number
}

export type RecorteDaFila = 'pending' | 'reconciled'

export const carregarFila = (scope: RecorteDaFila) =>
  pedir<{ transactions: TransacaoBancaria[]; pendingCount: number }>(
    `/conciliacao/transacoes?scope=${scope}`,
  )

export const carregarSugestoes = (transacaoId: string) =>
  pedir<{ suggestions: Sugestao[] }>(
    `/conciliacao/transacoes/${encodeURIComponent(transacaoId)}/sugestoes`,
  )

export const conciliar = (
  transacaoId: string,
  entrada: { entryKind: TipoDeLancamento; entryId: string },
) =>
  pedir<unknown>(`/conciliacao/transacoes/${encodeURIComponent(transacaoId)}/conciliar`, {
    method: 'POST',
    body: entrada,
  })

export const criarLancamentoDaTransacao = (
  transacaoId: string,
  entrada: { counterparty: string; description: string },
) =>
  pedir<unknown>(`/conciliacao/transacoes/${encodeURIComponent(transacaoId)}/lancamento`, {
    method: 'POST',
    body: entrada,
  })

export const desfazerConciliacao = (transacaoId: string, reason: string) =>
  pedir<unknown>(`/conciliacao/transacoes/${encodeURIComponent(transacaoId)}/desfazer`, {
    method: 'POST',
    body: { reason },
  })

/** O extrato vai em base64 dentro do JSON, como no web. */
export const importarExtrato = (nome: string, base64: string) =>
  pedir<{ imported: number; ignored: number; format: 'ofx' | 'csv'; account: string | null }>(
    '/extratos',
    { method: 'POST', body: { filename: nome, contentBase64: base64 } },
  )
