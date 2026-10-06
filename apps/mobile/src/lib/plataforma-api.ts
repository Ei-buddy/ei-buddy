import { chamarApi } from './api'

/**
 * Area da plataforma (Super Admin) — ADR-0007, as mesmas rotas do web.
 *
 * Empresas (e entrar numa com justificativa), usuarios e quem e Super Admin,
 * a lista de espera do pre-lancamento e os pedidos de Parceiro. O servidor
 * recusa tudo isto para quem nao e Super Admin; a tela so esconde o caminho.
 */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

async function pedir<T>(
  caminho: string,
  opcoes: { method?: string; body?: unknown } = {},
): Promise<Resultado<T>> {
  const r = await chamarApi<T>(caminho, opcoes)
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

/* --- Perfil ----------------------------------------------------------- */

export type Perfil = {
  activeCompanyId: string | null
  companyName: string | null
  isImpersonating: boolean
  isPlatformAdmin: boolean
}

export const carregarPerfil = () => pedir<Perfil>('/auth/perfil')

/* --- Empresas --------------------------------------------------------- */

export type EmpresaListada = {
  id: string
  legalName: string
  tradeName: string | null
  cnpj: string
  isActive: boolean
  createdAt: string
}

export const listarEmpresas = () => pedir<{ companies: EmpresaListada[] }>('/admin/empresas')

/** O motivo vai para a trilha de auditoria; o contrato pede 10 caracteres. */
export const JUSTIFICATIVA_MINIMA = 10

export const entrarNaEmpresa = (companyId: string, justification: string) =>
  pedir<{ activeCompanyId: string; role: string }>('/admin/entrar', {
    method: 'POST',
    body: { companyId, justification: justification.trim() },
  })

export const sairDoModoAdmin = () =>
  pedir<{ activeCompanyId: null }>('/admin/sair', { method: 'POST' })

/* --- Usuarios e Super Admins ------------------------------------------ */

export const ROTULO_PAPEL: Record<string, string> = {
  owner: 'Dono',
  staff: 'Funcionário',
  manager: 'Gerente',
  cashier: 'Caixa',
  accountant: 'Contador',
}

export type UsuarioDaPlataforma = {
  userId: string
  name: string
  email: string
  isActive: boolean
  isPlatformAdmin: boolean
  lastAccessAt: string | null
  companies: { companyId: string; name: string; role: string }[]
}

export function listarUsuarios(params: { q?: string; page?: number }) {
  const query = new URLSearchParams({ pageSize: '30' })
  if (params.q) query.set('q', params.q)
  if (params.page && params.page > 1) query.set('page', String(params.page))
  return pedir<{ users: UsuarioDaPlataforma[]; total: number }>(
    `/admin/usuarios?${query.toString()}`,
  )
}

export const convidarSuperAdmin = (email: string, name?: string) =>
  pedir<{ userId: string; created: boolean; temporaryPassword?: string }>('/admin/super-admins', {
    method: 'POST',
    body: name === undefined || name.trim() === '' ? { email } : { email, name: name.trim() },
  })

export const revogarSuperAdmin = (userId: string) =>
  pedir<unknown>(`/admin/super-admins/${encodeURIComponent(userId)}`, { method: 'DELETE' })

/* --- Lista de espera — NR-111 ----------------------------------------- */

export const ROTULO_DIFICULDADE: Record<string, string> = {
  cash_flow: 'Controlar o dinheiro',
  more_customers: 'Conseguir mais clientes',
  sales_organization: 'Organizar as vendas',
  inventory: 'Controlar produtos e estoque',
  collections: 'Cobrar clientes',
  routine: 'Organizar minha rotina',
  profit_visibility: 'Saber se estou tendo lucro',
  marketing: 'Divulgar meu negócio',
  other: 'Outra',
}

export const ROTULO_SISTEMA: Record<string, string> = {
  none: 'Não uso nenhum sistema',
  complicated: 'Sim, mas acho complicado',
  expensive: 'Sim, mas acho caro',
  satisfied: 'Sim e estou satisfeito',
  other: 'Outro',
}

export const ROTULO_VALOR: Record<string, string> = {
  up_to_29: 'Até R$ 29',
  from_30_to_49: 'R$ 30 a R$ 49',
  from_50_to_69: 'R$ 50 a R$ 69',
  from_70_to_99: 'R$ 70 a R$ 99',
  above_100: 'Acima de R$ 100',
  not_sure: 'Ainda não sei dizer',
}

type Contagem = { value: string; count: number }

export type ResumoDaListaVip = {
  total: number
  painPoints: Contagem[]
  usesSystem: Contagem[]
  fairPrice: Contagem[]
}

export const resumoListaVip = () => pedir<ResumoDaListaVip>('/admin/lista-vip/resumo')

export type RespostaListaVip = {
  id: string
  name: string
  businessType: string | null
  phone: string
  expectation: string
  createdAt: string
}

export function listarListaVip(params: { q?: string; page?: number }) {
  const query = new URLSearchParams({ pageSize: '30' })
  if (params.q) query.set('q', params.q)
  if (params.page && params.page > 1) query.set('page', String(params.page))
  return pedir<{ entries: RespostaListaVip[]; total: number }>(
    `/admin/lista-vip?${query.toString()}`,
  )
}

/* --- Parceiros — NR-115 ----------------------------------------------- */

export type CandidaturaDeParceiro = {
  partnerId: string
  companyName: string
  companyPhone: string
  companyEmail: string
  pixKey: string
  pixKeyType: string
  message: string
  couponCode: string | null
  createdAt: string
}

export const listarParceirosPendentes = () =>
  pedir<{ applications: CandidaturaDeParceiro[] }>('/admin/parceiros')

export const aprovarParceiro = (partnerId: string) =>
  pedir<unknown>(`/admin/parceiros/${encodeURIComponent(partnerId)}/aprovar`, {
    method: 'POST',
    body: {},
  })

export const recusarParceiro = (partnerId: string, note: string) =>
  pedir<unknown>(`/admin/parceiros/${encodeURIComponent(partnerId)}/recusar`, {
    method: 'POST',
    body: { note: note.trim() },
  })
