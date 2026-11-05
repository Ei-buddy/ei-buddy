import { chamarApi } from './api'

/**
 * Cadastro de fornecedor — NR-191, as mesmas rotas do web
 * (`/cadastros/fornecedores`; `/fornecedores` e a busca por proximidade).
 */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

export type FornecedorCadastrado = {
  id: string
  name: string
  tradeName: string | null
  document: string | null
  stateRegistration: string | null
  email: string | null
  phone: string | null
  contactName: string | null
  address: {
    zipCode: string | null
    street: string | null
    number: string | null
    complement: string | null
    district: string | null
    city: string | null
    state: string | null
  }
  notes: string | null
  isActive: boolean
}

/** Campo vazio nao vai no cadastro; na edicao vira `null`. */
export type DadosDoFornecedor = {
  name: string
  tradeName?: string | null
  document?: string | null
  stateRegistration?: string | null
  email?: string | null
  phone?: string | null
  contactName?: string | null
  address?: Record<string, string>
  notes?: string | null
  isActive?: boolean
}

const ROTA = '/cadastros/fornecedores'

export async function listarFornecedores(opcoes: {
  termo?: string
  incluirInativos?: boolean
}): Promise<Resultado<FornecedorCadastrado[]>> {
  const q = new URLSearchParams()
  if (opcoes.termo?.trim()) q.set('q', opcoes.termo.trim())
  if (opcoes.incluirInativos) q.set('somenteAtivos', 'false')
  const r = await chamarApi<{ suppliers: FornecedorCadastrado[] }>(
    `${ROTA}${q.toString() ? `?${q.toString()}` : ''}`,
  )
  return r.ok ? { ok: true, dados: r.dados.suppliers } : { ok: false, erro: r.message }
}

export async function salvarFornecedor(
  dados: DadosDoFornecedor,
  id?: string,
): Promise<Resultado<FornecedorCadastrado>> {
  const r = await chamarApi<FornecedorCadastrado>(
    id === undefined ? ROTA : `${ROTA}/${encodeURIComponent(id)}`,
    { method: id === undefined ? 'POST' : 'PATCH', body: dados },
  )
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

export async function excluirFornecedor(id: string): Promise<Resultado<null>> {
  const r = await chamarApi<unknown>(`${ROTA}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return r.ok ? { ok: true, dados: null } : { ok: false, erro: r.message }
}

/** `11222333000181` → `11.222.333/0001-81`; CPF com a mascara dele. */
export function documentoFormatado(d: string | null): string {
  if (d === null) return ''
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d
}

export function telefoneFormatado(t: string | null): string {
  if (t === null) return ''
  if (t.length === 11) return t.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (t.length === 10) return t.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return t
}
