import { describe, expect, it } from 'vitest'
import { partnerAccountFieldsSchema } from './partner.js'

describe('chave PIX combina com o tipo', () => {
  const base = { message: 'Divulgo para lojistas da minha regiao.' }

  it.each([
    ['EMAIL', 'parceiro@loja.com.br'],
    ['CPF', '529.982.247-25'],
    ['CNPJ', '11.222.333/0001-81'],
    ['PHONE', '+55 (41) 99876-5432'],
    ['EVP', '123e4567-e89b-12d3-a456-426614174000'],
  ] as const)('aceita %s valido', (pixKeyType, pixKey) => {
    expect(partnerAccountFieldsSchema.safeParse({ ...base, pixKey, pixKeyType }).success).toBe(true)
  })

  it.each([
    ['EMAIL', 'abc'],
    ['CPF', '123'],
    ['CNPJ', '11222333000100'],
    ['PHONE', '12'],
    ['EVP', 'xyz'],
  ] as const)('recusa %s fora do formato, no campo pixKey', (pixKeyType, pixKey) => {
    const r = partnerAccountFieldsSchema.safeParse({ ...base, pixKey, pixKeyType })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toEqual(['pixKey'])
  })
})
