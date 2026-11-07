import type { DreLine, DreOutput } from '@na-regua/contracts'
import { pedir, type Resultado } from './http'

/**
 * Plano de contas, classificacao e DRE contra a api — NR-077, RF-081 a RF-086.
 *
 * Tudo pelo BFF em `/api/...`: o token da sessao fica num cookie `httpOnly`.
 */

export type TipoDeConta = 'revenue' | 'deduction' | 'cost' | 'expense'

export type ContaContabil = {
  id: string
  name: string
  type: TipoDeConta
  /** Conta do plano padrao nao pode ser apagada — RF-081, RF-082. */
  isDefault: boolean
}

/**
 * O DRE como a api devolve — o contrato e a fonte, para a tela nao desenhar um
 * campo que a api deixou de mandar (ou deixar de desenhar um que chegou).
 */
export type LinhaDoDre = DreLine
export type Dre = DreOutput

/** O rotulo de cada tipo, num lugar so. */
export const ROTULO_DO_TIPO: Record<TipoDeConta, string> = {
  revenue: 'Receita',
  deduction: 'Dedução',
  cost: 'Custo',
  expense: 'Despesa',
}

export const carregarPlano = (): Promise<Resultado<{ accounts: ContaContabil[] }>> =>
  pedir('/api/contas-contabeis')

export const criarConta = (entrada: {
  name: string
  type: TipoDeConta
}): Promise<Resultado<ContaContabil>> =>
  pedir('/api/contas-contabeis', { method: 'POST', body: JSON.stringify(entrada) })

export const renomearConta = (accountId: string, name: string): Promise<Resultado<ContaContabil>> =>
  pedir(`/api/contas-contabeis/${accountId}`, { method: 'PATCH', body: JSON.stringify({ name }) })

export const apagarConta = (accountId: string): Promise<Resultado<unknown>> =>
  pedir(`/api/contas-contabeis/${accountId}`, { method: 'DELETE' })

/**
 * O DRE do periodo — RF-085.
 *
 * O periodo vai explicito, sempre. A api nao tem padrao de "mes atual" de
 * proposito: um padrao escondido faria a tela, o assistente e a exportacao
 * discordarem no dia 1 de cada mes.
 */
export const carregarDre = (from: string, to: string): Promise<Resultado<Dre>> =>
  pedir(`/api/relatorios/dre?from=${from}&to=${to}`)

/** Como o plano de contas aparece na lista — achado do QA. */
export type OrdemDoPlano = 'tipo' | 'nome' | 'nome-desc'
export type FiltroDoPlano = TipoDeConta | 'todos'

/**
 * O plano de contas filtrado por tipo e ordenado — achado do QA ("poder
 * ordenar por nome; poder filtrar por tipo").
 *
 * `tipo` mantem a ordem do servidor (receita, deducao, custo, despesa — a
 * ordem do DRE). Por nome, em portugues: acento e maiuscula nao mudam a ordem
 * ("Água" junto de "Aluguel", nao depois do Z).
 */
export function planoNaTela<T extends { readonly name: string; readonly type: TipoDeConta }>(
  contas: readonly T[],
  filtro: FiltroDoPlano,
  ordem: OrdemDoPlano,
): T[] {
  const filtradas = filtro === 'todos' ? [...contas] : contas.filter((c) => c.type === filtro)
  if (ordem === 'tipo') return filtradas
  const porNome = (a: T, b: T) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true })
  return filtradas.sort(ordem === 'nome' ? porNome : (a, b) => porNome(b, a))
}
