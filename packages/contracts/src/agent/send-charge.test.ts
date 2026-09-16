import { describe, expect, it } from 'vitest'
import { sendChargeInputSchema } from './send-charge.js'

describe('sendChargeInputSchema — US-052 / RF-107', () => {
  it('aceita so customerId', () => {
    expect(sendChargeInputSchema.parse({ customerId: 'cli-1' })).toEqual({ customerId: 'cli-1' })
  })

  it('aceita so telefone e guarda so digitos', () => {
    expect(sendChargeInputSchema.parse({ phone: '11 98888-7777' })).toEqual({
      phone: '11988887777',
    })
  })

  it('aceita os dois juntos', () => {
    const r = sendChargeInputSchema.parse({ customerId: 'cli-1', phone: '11988887777' })
    expect(r.customerId).toBe('cli-1')
    expect(r.phone).toBe('11988887777')
  })

  it('recusa vazio — precisa de cliente ou telefone', () => {
    expect(sendChargeInputSchema.safeParse({}).success).toBe(false)
  })

  it('recusa companyId — tenant nao entra no input da tool', () => {
    expect(
      sendChargeInputSchema.safeParse({ customerId: 'cli-1', companyId: 'emp-1' }).success,
    ).toBe(false)
  })

  it('recusa campo extra', () => {
    expect(sendChargeInputSchema.safeParse({ customerId: 'cli-1', name: 'Joao' }).success).toBe(
      false,
    )
  })
})
