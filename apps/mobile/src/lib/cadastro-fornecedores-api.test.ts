import { describe, expect, it, vi } from 'vitest'
import { nomeDoFornecedor, pareceDocumento } from './cadastro-fornecedores-api'

vi.mock('./api', () => ({ chamarApi: vi.fn() }))

/**
 * Campo de fornecedor ligado ao cadastro — achado do QA ("assumir a busca no
 * novo cadastro do fornecedor"). O que foi buscado e nao achado abre o
 * cadastro rapido: documento vai para o CNPJ/CPF, o resto para o nome.
 */
describe('pareceDocumento', () => {
  it('CNPJ e CPF, com ou sem mascara, sao documento', () => {
    expect(pareceDocumento('11.444.777/0001-61')).toBe(true)
    expect(pareceDocumento('11444777000161')).toBe(true)
    expect(pareceDocumento('529.982.247-25')).toBe(true)
    expect(pareceDocumento('  52998224725 ')).toBe(true)
  })

  it('nome com numero continua sendo nome', () => {
    expect(pareceDocumento('Distribuidora 2000')).toBe(false)
    expect(pareceDocumento('Casa 12345678901')).toBe(false)
  })

  it('poucos digitos (comeco de CNPJ, telefone curto) nao e documento', () => {
    expect(pareceDocumento('11.444')).toBe(false)
    expect(pareceDocumento('3333-4444')).toBe(false)
    expect(pareceDocumento('')).toBe(false)
  })
})

describe('nomeDoFornecedor', () => {
  const base = { id: 'f1', name: 'Torrefacao Aurora LTDA' } as Parameters<
    typeof nomeDoFornecedor
  >[0]

  it('usa o nome fantasia quando ha', () => {
    expect(nomeDoFornecedor({ ...base, tradeName: 'Aurora' })).toBe('Aurora')
  })

  it('sem fantasia, a razao social', () => {
    expect(nomeDoFornecedor({ ...base, tradeName: null })).toBe('Torrefacao Aurora LTDA')
  })
})
