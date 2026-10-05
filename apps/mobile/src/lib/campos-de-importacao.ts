import { isValidCNPJ, isValidCPF } from './validation'
import { centavosDoTexto } from './valor'

/**
 * Os campos que cada importacao pede e a validacao de cada linha — os mesmos
 * do web. Cidade e UF nao entram em clientes: a planilha nao tem onde por.
 */

export const CAMPOS_CLIENTES = [
  {
    key: 'nome',
    label: 'Nome / Razão social',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('nome') || c.includes('razao'),
  },
  {
    key: 'documento',
    label: 'CPF / CNPJ',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('cpf') || c.includes('cnpj') || c.includes('documento'),
  },
  {
    key: 'celular',
    label: 'Celular',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('tel') || c.includes('cel') || c.includes('whats'),
  },
  {
    key: 'email',
    label: 'E-mail',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('mail'),
  },
]

export function validarCliente(v: Record<string, string>): string | null {
  if (!v.nome?.trim()) return 'Nome vazio'
  const doc = (v.documento ?? '').replace(/\D/g, '')
  if (!doc) return 'CPF/CNPJ vazio'
  const ok = doc.length === 11 ? isValidCPF(doc) : doc.length === 14 ? isValidCNPJ(doc) : false
  return ok ? null : 'CPF/CNPJ inválido'
}

export const CAMPOS_PRODUTOS = [
  {
    key: 'descricao',
    label: 'Descrição',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('descri') || c.includes('produto') || c.includes('nome'),
  },
  {
    key: 'precoVenda',
    label: 'Preço de venda',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('venda') || c.includes('preco') || c.includes('preço'),
  },
  {
    key: 'precoCusto',
    label: 'Preço de custo',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('custo'),
  },
  {
    key: 'ean',
    label: 'EAN',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('ean') || c.includes('barras') || c.includes('gtin'),
  },
  {
    key: 'ncm',
    label: 'NCM',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('ncm'),
  },
  {
    key: 'estoque',
    label: 'Estoque',
    obrigatorio: false,
    reconhece: (c: string) =>
      c.includes('estoque') || c.includes('quantidade') || c.includes('qtd'),
  },
]

export function validarProduto(v: Record<string, string>): string | null {
  if (!v.descricao?.trim()) return 'Descrição vazia'
  const venda = centavosDoTexto(v.precoVenda)
  if (venda === null || venda <= 0) return 'Preço de venda inválido'
  return null
}
