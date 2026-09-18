import { describe, expect, it } from 'vitest'
import { checkCustomerWalletInputSchema } from './customer.js'

describe('input da consulta conversacional de fiado — NR-115', () => {
  it('aceita uma consulta de cliente preenchida e recusa texto vazio ou campos extras', () => {
    expect(checkCustomerWalletInputSchema.parse({ query: ' Maria Silva ' })).toEqual({
      query: 'Maria Silva',
    })
    expect(checkCustomerWalletInputSchema.safeParse({ query: '   ' }).success).toBe(false)
    expect(
      checkCustomerWalletInputSchema.safeParse({ query: 'Maria', companyId: 'empresa-alheia' })
        .success,
    ).toBe(false)
  })
})
