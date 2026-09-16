import { pedir, type Resultado } from './http'
import type { FairPrice, PainPoint, UsesSystem } from './waitlist-api'

/**
 * O painel do Super Admin — ADR-0007, RF-131.
 *
 * "Entrar como" e a troca de sessao auditada: depois de `entrarNaEmpresa`, o
 * `/api/session` GET passa a devolver a empresa escolhida, e toda tela de
 * negocio funciona normalmente — nenhuma delas sabe que quem esta do outro
 * lado e Super Admin.
 */

export type EmpresaListada = {
  id: string
  legalName: string
  tradeName: string | null
  cnpj: string
  isActive: boolean
  createdAt: string
}

export type SuperAdmin = {
  userId: string
  name: string
  email: string
  grantedAt: string
}

export const listarEmpresas = (): Promise<Resultado<{ companies: EmpresaListada[] }>> =>
  pedir('/api/admin/empresas')

export const entrarNaEmpresa = (
  companyId: string,
  justification: string,
): Promise<Resultado<{ activeCompanyId: string; role: string }>> =>
  pedir('/api/admin/entrar', {
    method: 'POST',
    body: JSON.stringify({ companyId, justification }),
  })

export const sairDoModoAdmin = (): Promise<Resultado<{ activeCompanyId: null }>> =>
  pedir('/api/admin/sair', { method: 'POST' })

export const listarSuperAdmins = (): Promise<Resultado<{ admins: SuperAdmin[] }>> =>
  pedir('/api/admin/super-admins')

export const convidarSuperAdmin = (
  email: string,
  name?: string,
): Promise<Resultado<{ userId: string; created: boolean; temporaryPassword?: string }>> =>
  pedir('/api/admin/super-admins', {
    method: 'POST',
    body: JSON.stringify(name === undefined ? { email } : { email, name }),
  })

/**
 * Tira o acesso de Super Admin — ADR-0007.
 *
 * A api recusa revogar a si mesmo: sem essa guarda o ultimo Super Admin
 * deixaria a plataforma sem ninguem que possa administrar.
 */
export const revogarSuperAdmin = (userId: string): Promise<Resultado<void>> =>
  pedir(`/api/admin/super-admins/${userId}`, { method: 'DELETE' })

/* -------------------------------------------------------------------------- */
/* Lista de espera do pre-lancamento — NR-111                                 */
/* -------------------------------------------------------------------------- */

const CABECALHO_CHAVE_LISTA_VIP = 'x-waitlist-admin-key'
const CHAVE_LISTA_VIP_LOCALSTORAGE = 'na-regua:lista-vip-admin-key'

/**
 * A chave provisoria do painel, guardada so neste navegador — NR-111.
 *
 * Existe para o painel funcionar sem o primeiro Super Admin (ver
 * `ChaveDeAcessoListaVip`, `proxy.ts`, `routes/waitlist.ts`). `try/catch`:
 * modo privado e alguns navegadores derrubam o acesso a `localStorage`, e
 * pedir a chave de novo e melhor que a tela quebrar.
 */
export function lerChaveDaListaVip(): string | null {
  try {
    return localStorage.getItem(CHAVE_LISTA_VIP_LOCALSTORAGE)
  } catch {
    return null
  }
}

export function salvarChaveDaListaVip(chave: string): void {
  try {
    localStorage.setItem(CHAVE_LISTA_VIP_LOCALSTORAGE, chave)
  } catch {
    /* Sem storage disponivel: a chave vale so para esta renderizacao. */
  }
}

export function esquecerChaveDaListaVip(): void {
  try {
    localStorage.removeItem(CHAVE_LISTA_VIP_LOCALSTORAGE)
  } catch {
    /* Nada gravado, nada para apagar. */
  }
}

function cabecalhoDaChave(): Record<string, string> {
  const chave = lerChaveDaListaVip()
  return chave === null ? {} : { [CABECALHO_CHAVE_LISTA_VIP]: chave }
}

export type RespostaListaVip = {
  id: string
  name: string
  businessType: string | null
  phone: string
  expectation: string
  painPoints: PainPoint[]
  painPointOther: string | null
  usesSystem: UsesSystem | null
  usesSystemOther: string | null
  fairPrice: FairPrice | null
  wantsUpdates: boolean
  createdAt: string
}

export type PaginaDaListaVip = {
  entries: RespostaListaVip[]
  total: number
  page: number
  pageSize: number
}

export const listarRespostasListaVip = (
  params: { q?: string; page?: number; pageSize?: number } = {},
): Promise<Resultado<PaginaDaListaVip>> => {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.page) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))
  const qs = query.toString()
  return pedir(`/api/admin/lista-vip${qs === '' ? '' : `?${qs}`}`, { headers: cabecalhoDaChave() })
}

export type ContagemPorChave<T extends string> = { value: T; count: number }

export type ResumoDaListaVip = {
  total: number
  painPoints: ContagemPorChave<PainPoint>[]
  usesSystem: ContagemPorChave<UsesSystem>[]
  fairPrice: ContagemPorChave<FairPrice>[]
  perDay: { date: string; count: number }[]
}

export const resumoListaVip = (): Promise<Resultado<ResumoDaListaVip>> =>
  pedir('/api/admin/lista-vip/resumo', { headers: cabecalhoDaChave() })

/* --- Usuarios da plataforma — NR-121 ---------------------------------- */

export type PapelNaLoja = 'owner' | 'staff' | 'accountant'

export const ROTULO_PAPEL: Record<PapelNaLoja, string> = {
  owner: 'Dono',
  staff: 'Funcionário',
  accountant: 'Contador',
}

export type UsuarioDaPlataforma = {
  userId: string
  name: string
  email: string
  isActive: boolean
  createdAt: string
  isPlatformAdmin: boolean
  /** Nulo em quem nunca entrou. */
  lastAccessAt: string | null
  companies: { companyId: string; name: string; role: PapelNaLoja }[]
}

export type PaginaDeUsuarios = {
  users: UsuarioDaPlataforma[]
  total: number
  page: number
  pageSize: number
}

export const listarUsuariosDaPlataforma = (
  params: { q?: string; page?: number; pageSize?: number } = {},
): Promise<Resultado<PaginaDeUsuarios>> => {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.page) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))
  const qs = query.toString()
  return pedir(`/api/admin/usuarios${qs === '' ? '' : `?${qs}`}`)
}
