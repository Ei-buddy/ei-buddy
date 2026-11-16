import { pedir, type Resultado } from './http'

/**
 * Cadastro de fornecedor — NR-191. As rotas sao `/cadastros/fornecedores`:
 * `/fornecedores` e a busca por proximidade (Conexoes), outra coisa.
 */
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
  createdAt: string
}

/** O que o formulario manda. Campo vazio nao vai no cadastro; na edicao vira `null`. */
export type DadosDoFornecedor = {
  name: string
  tradeName?: string | null
  document?: string | null
  stateRegistration?: string | null
  email?: string | null
  phone?: string | null
  contactName?: string | null
  address?: {
    zipCode?: string
    street?: string
    number?: string
    complement?: string
    district?: string
    city?: string
    state?: string
  }
  notes?: string | null
  isActive?: boolean
}

const ROTA = '/api/cadastros/fornecedores'

export async function listarFornecedores(opcoes: {
  termo?: string
  incluirInativos?: boolean
}): Promise<Resultado<FornecedorCadastrado[]>> {
  const q = new URLSearchParams()
  if (opcoes.termo?.trim()) q.set('q', opcoes.termo.trim())
  if (opcoes.incluirInativos) q.set('somenteAtivos', 'false')
  const r = await pedir<{ suppliers: FornecedorCadastrado[] }>(
    `${ROTA}${q.size > 0 ? `?${q.toString()}` : ''}`,
  )
  return r.ok ? { ok: true, dados: r.dados.suppliers } : r
}

export const cadastrarFornecedor = (dados: DadosDoFornecedor) =>
  pedir<FornecedorCadastrado>(ROTA, { method: 'POST', body: JSON.stringify(dados) })

export const editarFornecedor = (id: string, dados: DadosDoFornecedor) =>
  pedir<FornecedorCadastrado>(`${ROTA}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(dados),
  })

export const excluirFornecedor = (id: string) =>
  pedir<unknown>(`${ROTA}/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** `11222333000181` → `11.222.333/0001-81`; CPF com a mascara dele. */
export function documentoFormatado(d: string | null): string {
  if (d === null) return ''
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d
}

/** `4133334444` → `(41) 3333-4444`; celular com o nove. */
export function telefoneFormatado(t: string | null): string {
  if (t === null) return ''
  if (t.length === 11) return t.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (t.length === 10) return t.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return t
}

const soDigitos = (t: string) => t.replace(/\D/g, '')

/** O nome que aparece no produto e na compra: o fantasia, quando ha. */
export const nomeDoFornecedor = (f: FornecedorCadastrado) => f.tradeName ?? f.name

/**
 * O texto buscado e um documento? So digitos e pontuacao de CNPJ/CPF, com 11
 * ou mais digitos — "Distribuidora 2000" continua sendo nome.
 */
export function pareceDocumento(texto: string): boolean {
  const t = texto.trim()
  return /^[\d./\s-]+$/.test(t) && soDigitos(t).length >= 11
}
