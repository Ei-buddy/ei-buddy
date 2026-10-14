import { chamarApi } from './api'

/**
 * Plano de contas e DRE contra a api — NR-077, RF-081 a RF-086, US-041.
 *
 * O DRE fala com `GET /relatorios/dre`, a mesma rota do web. O app NAO tem uma
 * conta propria: a ordem das subtracoes vem de `domain` e chega pronta, e e
 * exatamente a parte que nao pode variar entre a tela do celular, a do
 * computador e o resumo do assistente. Somar aqui daria uma segunda resposta
 * para "o mes fechou no azul".
 *
 * Criar, renomear e apagar conta NAO estao aqui de proposito — sao cadastros
 * feitos uma vez, com calma, e ficam no web. O celular so consulta.
 */

export type TipoDeConta = 'revenue' | 'deduction' | 'cost' | 'expense'

export type LinhaDoDre = {
  readonly accountId: string | null
  readonly accountName: string
  readonly type: TipoDeConta
  readonly amountCents: number
  readonly entryCount: number
}

export type Dre = {
  readonly from: string
  readonly to: string
  readonly grossRevenueCents: number
  readonly deductionsCents: number
  readonly netRevenueCents: number
  readonly costCents: number
  readonly grossProfitCents: number
  readonly expensesCents: number
  readonly resultCents: number
  /** Pontos por cem (18 = 18%). Nulo quando nao houve receita. */
  readonly grossMarginPoints: number | null
  readonly lines: readonly LinhaDoDre[]
}

export type Resultado<T> =
  { readonly ok: true; readonly dados: T } | { readonly ok: false; readonly erro: string }

/** Conta do plano — RF-081, RF-082. */
export type ContaContabil = {
  readonly id: string
  readonly name: string
  readonly type: TipoDeConta
  /** Conta do plano padrao nao pode ser apagada. */
  readonly isDefault: boolean
}

/**
 * O mes de uma data, em `AAAA-MM-DD`.
 *
 * Campos LOCAIS, nunca `toISOString`: no fuso do Brasil o dia 1 as 00h ainda e
 * o dia 30 em UTC, e o mes comecaria no anterior. O mesmo cuidado de
 * `hojeLocal` na agenda.
 */
export function mesLocal(agora: Date = new Date()): { de: string; ate: string } {
  const ano = agora.getFullYear()
  const mes = agora.getMonth()
  const dois = (n: number) => String(n).padStart(2, '0')

  /* Dia 0 do mes seguinte e o ultimo deste — inclusive em fevereiro bissexto. */
  const ultimo = new Date(ano, mes + 1, 0).getDate()

  return {
    de: `${ano}-${dois(mes + 1)}-01`,
    ate: `${ano}-${dois(mes + 1)}-${dois(ultimo)}`,
  }
}

export async function carregarDre(de: string, ate: string): Promise<Resultado<Dre>> {
  const r = await chamarApi<Dre>(
    `/relatorios/dre?from=${encodeURIComponent(de)}&to=${encodeURIComponent(ate)}`,
  )

  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

/**
 * O plano de contas — RF-081, RF-082.
 *
 * A tela do celular lia `financeiro-api.ts`, com contas de exemplo e um
 * "gasto no mes" por conta que era numero inventado — mesmo depois de o web
 * ja falar com esta rota de verdade.
 */
export async function carregarPlano(): Promise<Resultado<{ accounts: ContaContabil[] }>> {
  const r = await chamarApi<{ accounts: ContaContabil[] }>('/contas-contabeis')

  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

/** O rotulo de cada tipo, num lugar so. */
export const ROTULO_DO_TIPO: Record<TipoDeConta, string> = {
  revenue: 'Receita',
  deduction: 'Dedução',
  cost: 'Custo',
  expense: 'Despesa',
}

export async function criarConta(entrada: {
  name: string
  type: TipoDeConta
}): Promise<Resultado<ContaContabil>> {
  const r = await chamarApi<ContaContabil>('/contas-contabeis', { method: 'POST', body: entrada })
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

export async function renomearConta(id: string, name: string): Promise<Resultado<ContaContabil>> {
  const r = await chamarApi<ContaContabil>(`/contas-contabeis/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { name },
  })
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

/** Conta do plano padrao, ou com lancamento, o servidor recusa — e diz por que. */
export async function apagarConta(id: string): Promise<Resultado<null>> {
  const r = await chamarApi<unknown>(`/contas-contabeis/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  return r.ok ? { ok: true, dados: null } : { ok: false, erro: r.message }
}
