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
