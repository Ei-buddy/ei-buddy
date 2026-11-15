import { describe, expect, it } from 'vitest'
import { CAMPOS_CLIENTES, validarCliente } from './campos-de-importacao'

/* Uma linha completa da planilha (NR-142; endereco opcional desde a DEC-025 revisada). */
const LINHA = {
  nome: 'Ana Souza',
  documento: '529.982.247-25',
  celular: '(41) 99876-5432',
  cep: '80010-000',
  rua: 'Rua XV de Novembro',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Curitiba',
  uf: 'PR',
}

describe('importacao de clientes — NR-142, DEC-025 revisada', () => {
  it('aceita a linha com celular e endereco completos', () => {
    expect(validarCliente(LINHA)).toBeNull()
  })

  it.each([
    ['celular', 'Celular com DDD vazio ou inválido'],
    ['cep', 'CEP vazio ou inválido'],
    ['rua', 'Rua vazio'],
    ['bairro', 'Bairro vazio'],
    ['uf', 'UF vazia ou inválida'],
  ] as const)('endereco pela metade: recusa a linha sem %s', (campo, motivo) => {
    expect(validarCliente({ ...LINHA, [campo]: '' })).toBe(motivo)
  })

  it('aceita a linha sem endereco nenhum — DEC-025 revisada', () => {
    expect(
      validarCliente({ ...LINHA, cep: '', rua: '', numero: '', bairro: '', cidade: '', uf: '' }),
    ).toBeNull()
  })

  it('obrigatorios na planilha: nome, documento e celular', () => {
    const obrigatorios = CAMPOS_CLIENTES.filter((c) => c.obrigatorio).map((c) => c.key)
    expect(obrigatorios.sort()).toEqual(['celular', 'documento', 'nome'])
  })
})
