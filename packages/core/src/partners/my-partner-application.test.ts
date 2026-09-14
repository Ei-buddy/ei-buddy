import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '../context.js'
import { isAppError } from '../app-error.js'
import { InMemoryPartnerApplicationRepository } from './fakes.js'
import { getMyPartnerApplication } from './my-partner-application.js'
import { resendPartnerApplication } from './resend-partner-application.js'

const ctx = (companyId: string): ExecutionContext => ({
  companyId,
  userId: 'dono-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: new Date('2026-09-14T12:00:00.000Z'),
})

async function pegaErro(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}

describe('self-service de candidatura de Parceiro — NR-115', () => {
  it('empresa sem candidatura ve undefined, nao erro', async () => {
    const partners = new InMemoryPartnerApplicationRepository()
    const minha = await getMyPartnerApplication({ partners }, ctx('empresa-sem-candidatura'))
    expect(minha).toBeUndefined()
  })

  it('empresa com candidatura ve o status dela', async () => {
    const partners = new InMemoryPartnerApplicationRepository()
    await partners.submit({
      ownerUserId: 'dono-1',
      ownerCompanyId: 'empresa-1',
      pixKey: '41999990000',
      pixKeyType: 'PHONE',
      message: 'Motivo',
      couponCode: 'CODIGO1',
    })

    const minha = await getMyPartnerApplication({ partners }, ctx('empresa-1'))
    expect(minha?.status).toBe('pending')
    expect(minha?.couponCode).toBe('CODIGO1')
  })

  it('reenvio so funciona depois de recusada', async () => {
    const partners = new InMemoryPartnerApplicationRepository()
    await partners.submit({
      ownerUserId: 'dono-1',
      ownerCompanyId: 'empresa-1',
      pixKey: '41999990000',
      pixKeyType: 'PHONE',
      message: 'Motivo original',
      couponCode: 'CODIGO1',
    })

    const erro = await pegaErro(() =>
      resendPartnerApplication({ partners }, ctx('empresa-1'), {
        pixKey: '41988887777',
        pixKeyType: 'PHONE',
        message: 'Motivo novo, mais longo',
      }),
    )
    expect(erro).toBeDefined()
    expect(isAppError(erro)).toBe(false)

    await partners.review({
      reviewedBy: 'admin-1',
      partnerId: (await partners.mine('empresa-1'))!.partnerId,
      decision: 'reject',
      note: undefined,
    })

    await resendPartnerApplication({ partners }, ctx('empresa-1'), {
      pixKey: '41988887777',
      pixKeyType: 'PHONE',
      message: 'Motivo novo, mais longo',
    })

    const minha = await partners.mine('empresa-1')
    expect(minha?.status).toBe('pending')
    expect(minha?.pixKey).toBe('41988887777')
  })
})
