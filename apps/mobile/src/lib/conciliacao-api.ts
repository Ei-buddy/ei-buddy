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

/** Com a conta do extrato, ja da a baixa — DEC-026. */
export const conciliar = (
  transacaoId: string,
  entrada: { entryKind: TipoDeLancamento; entryId: string; bankAccount?: string },
) =>
  pedir<unknown>(`/conciliacao/transacoes/${encodeURIComponent(transacaoId)}/conciliar`, {
    method: 'POST',
    body: entrada,
  })

export const criarLancamentoDaTransacao = (
  transacaoId: string,
  entrada: { counterparty: string; description: string; bankAccount?: string },
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

/* -------------------------------------------------------------------------- */
/* Conciliar da baixa — DEC-026, as mesmas regras do web                      */
/* -------------------------------------------------------------------------- */

/** Uma linha do extrato e o lancamento que o servidor casou com ela. */
export type ParAutomatico = {
  transaction: Omit<TransacaoBancaria, 'reconciledWith'>
  suggestion: {
    entry: {
      kind: TipoDeLancamento
      id: string
      counterparty: string
      description: string
      dueDate: string
      amountCents: number
      netAmountCents: number | null
    }
    expectedAmountCents: number
    daysApart: number
    confidencePoints: number
    alternatives: number
  } | null
}

export type ResultadoDaConfirmacao = {
  reconciled: number
  settled: number
  order: { transactionId: string; postedOn: string; settlementId: string | null }[]
}

/** A fila inteira casada pelo servidor, NA ORDEM DO EXTRATO. */
export const carregarCasamentoAutomatico = () =>
  pedir<{ pairs: ParAutomatico[] }>('/conciliacao/automatica')

/** Confirma os pares e da baixa, na ordem do extrato. Tudo ou nada. */
export const confirmarConciliacoes = (
  bankAccount: string,
  pares: { transactionId: string; entryKind: TipoDeLancamento; entryId: string }[],
) =>
  pedir<ResultadoDaConfirmacao>('/conciliacao/confirmar', {
    method: 'POST',
    body: { bankAccount, pairs: pares },
  })

/** Os pares marcados que tem lancamento, na ordem do extrato (a da lista). */
export function paresMarcados(
  pares: ParAutomatico[],
  marcados: ReadonlySet<string>,
): { transactionId: string; entryKind: TipoDeLancamento; entryId: string }[] {
  return pares.flatMap((p) =>
    p.suggestion !== null && marcados.has(p.transaction.id)
      ? [
          {
            transactionId: p.transaction.id,
            entryKind: p.suggestion.entry.kind,
            entryId: p.suggestion.entry.id,
          },
        ]
      : [],
  )
}

/** Mesmo dia, sem outro lancamento do mesmo valor. */
export const semDuvida = (p: ParAutomatico): boolean =>
  p.suggestion !== null && p.suggestion.daysApart === 0 && p.suggestion.alternatives === 0

export function resumoDaConfirmacao(r: ResultadoDaConfirmacao): string {
  const conciliadas =
    r.reconciled === 1 ? '1 linha conciliada' : `${r.reconciled} linhas conciliadas`
  if (r.settled === r.reconciled) {
    return `${conciliadas} e baixada${r.reconciled === 1 ? '' : 's'}, na ordem do extrato.`
  }
  const jaQuitadas = r.reconciled - r.settled
  return `${conciliadas}: ${r.settled} baixa${r.settled === 1 ? '' : 's'} lançada${r.settled === 1 ? '' : 's'} na ordem do extrato, ${jaQuitadas} já estava${jaQuitadas === 1 ? '' : 'm'} quitada${jaQuitadas === 1 ? '' : 's'}.`
}
