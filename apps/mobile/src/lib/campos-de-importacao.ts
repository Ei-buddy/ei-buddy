import { isValidCNPJ, isValidCPF } from './validation'
import { centavosDoTexto } from './valor'

/**
 * Os campos que cada importacao pede e a validacao de cada linha — os mesmos
 * do web. Cliente leva celular e endereco completo, obrigatorios (NR-142).
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
    obrigatorio: true,
    reconhece: (c: string) => c.includes('tel') || c.includes('cel') || c.includes('whats'),
  },
  {
    key: 'email',
    label: 'E-mail',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('mail'),
  },
  {
    key: 'cep',
    label: 'CEP',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('cep'),
  },
  {
    key: 'rua',
    label: 'Rua',
    obrigatorio: true,
    reconhece: (c: string) =>
      c.includes('rua') || c.includes('logradouro') || c === 'endereço' || c === 'endereco',
  },
  {
    key: 'numero',
    label: 'Número',
    obrigatorio: true,
    reconhece: (c: string) =>
      c.includes('número') || c.includes('numero') || c === 'nº' || c === 'n',
  },
  {
    key: 'complemento',
    label: 'Complemento',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('complemento'),
  },
  {
    key: 'bairro',
    label: 'Bairro',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('bairro'),
  },
  {
    key: 'cidade',
    label: 'Cidade',
    obrigatorio: true,
    reconhece: (c: string) =>
      c.includes('cidade') || c.includes('municipio') || c.includes('município'),
  },
  {
    key: 'uf',
    label: 'UF',
    obrigatorio: true,
    reconhece: (c: string) => c === 'uf' || c.includes('estado'),
  },
]

export function validarCliente(v: Record<string, string>): string | null {
  if (!v.nome?.trim()) return 'Nome vazio'
  const doc = (v.documento ?? '').replace(/\D/g, '')
  if (!doc) return 'CPF/CNPJ vazio'
  const ok = doc.length === 11 ? isValidCPF(doc) : doc.length === 14 ? isValidCNPJ(doc) : false
  if (!ok) return 'CPF/CNPJ inválido'
  /* Celular e endereco sao obrigatorios no cadastro (NR-142). */
  const celular = (v.celular ?? '').replace(/\D/g, '')
  if (celular.length !== 10 && celular.length !== 11) return 'Celular com DDD vazio ou inválido'
  if ((v.cep ?? '').replace(/\D/g, '').length !== 8) return 'CEP vazio ou inválido'
  for (const [campo, rotulo] of [
    ['rua', 'Rua'],
    ['numero', 'Número'],
    ['bairro', 'Bairro'],
    ['cidade', 'Cidade'],
  ] as const) {
    if (!v[campo]?.trim()) return `${rotulo} vazio`
  }
  if ((v.uf ?? '').trim().length !== 2) return 'UF vazia ou inválida'
  return null
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
