import { describe, expect, it } from 'vitest'
import { CAMPOS_CLIENTES, validarCliente } from './campos-de-importacao'

/* Uma linha completa da planilha: o minimo que o cadastro aceita (NR-142). */
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

describe('importacao de clientes — NR-142', () => {
  it('aceita a linha com celular e endereco completos', () => {
    expect(validarCliente(LINHA)).toBeNull()
  })

  it.each([
    ['celular', 'Celular com DDD vazio ou inválido'],
    ['cep', 'CEP vazio ou inválido'],
    ['rua', 'Rua vazio'],
    ['bairro', 'Bairro vazio'],
    ['uf', 'UF vazia ou inválida'],
  ] as const)('recusa a linha sem %s', (campo, motivo) => {
    expect(validarCliente({ ...LINHA, [campo]: '' })).toBe(motivo)
  })

  it('so o complemento e o e-mail ficam opcionais na planilha', () => {
    const opcionais = CAMPOS_CLIENTES.filter((c) => !c.obrigatorio).map((c) => c.key)
    expect(opcionais.sort()).toEqual(['complemento', 'email'])
  })
})
