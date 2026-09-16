import { pedir, type Resultado } from './http'

/**
 * Quem esta logado, e em qual loja — NR-013, RF-119.
 *
 * A barra do topo mostrava "Marina Alves / Mercearia Sol Nascente" fixo no
 * codigo, para toda loja. Este modulo e o que a faz mostrar quem de fato entrou.
 */

export type Vinculo = {
  companyId: string
  companyName: string
  role: 'owner' | 'manager' | 'cashier' | 'accountant'
}

export type Perfil = {
  userId: string
  userName: string
  /** Nulo enquanto a pessoa nao escolheu loja — US-059. */
  activeCompanyId: string | null
  companyName: string | null
  role: Vinculo['role'] | null
  memberships: Vinculo[]
  /** Sessao de Super Admin "dentro" desta empresa — ADR-0007. */
  isImpersonating: boolean
  /** Acesso a plataforma inteira — o que liga a secao Plataforma na barra. */
  isPlatformAdmin: boolean
}

export const carregarPerfil = (): Promise<Resultado<Perfil>> => pedir('/api/perfil')

/**
 * As iniciais que vao no avatar.
 *
 * Primeira e ULTIMA palavra, e nao as duas primeiras: "Maria da Silva" da "MS"
 * e nao "MD" — a preposicao no meio nao diz nada sobre quem a pessoa e.
 */
export function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase()
  return `${partes[0]![0]}${partes[partes.length - 1]![0]}`.toUpperCase()
}
