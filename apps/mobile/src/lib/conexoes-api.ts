import { chamarApi } from './api'

/**
 * Fornecedores e conexoes entre lojas — as mesmas rotas do web.
 *
 * Buscar quem vende um insumo por perto, pedir conexao, e aceitar, recusar ou
 * encerrar. O contato so aparece depois que os dois lados aceitam.
 */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

async function pedir<T>(
  caminho: string,
  opcoes: { method?: string; body?: unknown } = {},
): Promise<Resultado<T>> {
  const r = await chamarApi<T>(caminho, opcoes)
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

export type Fornecedor = {
  companyId: string
  companyName: string
  neighborhood: string | null
  city: string | null
  distanceKm: number | null
  products: string[]
}

export type SugestaoDeFornecedor = {
  companyId: string
  companyName: string
  neighborhood: string | null
  city: string | null
  distanceKm: number | null
  peerCount: number
}

export type Conexao = {
  id: string
  direction: 'sent' | 'received'
  status: 'pending' | 'accepted' | 'rejected' | 'expired'
  otherCompanyName: string
  contact: {
    phone: string
    street: string | null
    streetNumber: string | null
    neighborhood: string | null
    city: string | null
    state: string | null
  } | null
}

export const buscarFornecedores = (termo: string) =>
  pedir<{ results: Fornecedor[] }>(`/fornecedores?termo=${encodeURIComponent(termo)}`)

export const buscarSugestoes = () =>
  pedir<{ suggestions: SugestaoDeFornecedor[] }>('/fornecedores/sugestoes')

export const pedirConexao = (targetCompanyId: string) =>
  pedir<{ id: string }>('/conexoes', { method: 'POST', body: { targetCompanyId } })

export const listarConexoes = () => pedir<{ connections: Conexao[] }>('/conexoes')

export const aceitarConexao = (id: string) =>
  pedir<unknown>(`/conexoes/${encodeURIComponent(id)}/aceitar`, { method: 'POST' })

export const recusarConexao = (id: string) =>
  pedir<unknown>(`/conexoes/${encodeURIComponent(id)}/recusar`, { method: 'POST' })

export const encerrarConexao = (id: string) =>
  pedir<unknown>(`/conexoes/${encodeURIComponent(id)}/encerrar`, { method: 'POST' })

/** Como no web: "menos de 1 km" ou "3,2 km"; nulo sem localizacao. */
export function formatarDistancia(km: number | null): string | null {
  if (km === null) return null
  return km < 1 ? 'menos de 1 km' : `${km.toFixed(1).replace('.', ',')} km`
}
