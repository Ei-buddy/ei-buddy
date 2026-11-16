import { describe, expect, it } from 'vitest'
import { InMemoryPlatformAdminAccess } from '../auth/fakes.js'
import { isAppError } from '../app-error.js'
import { InMemoryPartnerApplicationRepository } from './fakes.js'
import {
  approvePartnerApplication,
  listPendingPartnerApplications,
  rejectPartnerApplication,
} from './review-partner-application.js'

/**
 * Aprovacao de conta de Parceiro pelo Super Admin — NR-115, ADR-0013.
 *
 * O que se garante aqui: ninguem sem `isPlatformAdmin` chega perto da fila ou
 * da decisao — mesma disciplina de `waitlist-admin.test.ts`.
 */

const ADMIN_ID = 'user-admin'
const NAO_ADMIN_ID = 'user-comum'

function cenario() {
  const partners = new InMemoryPartnerApplicationRepository()
  const platformAdmin = new InMemoryPlatformAdminAccess({ aoEntrar: () => {}, aoSair: () => {} })
  platformAdmin.tornarSuperAdmin(ADMIN_ID)
  return { deps: { partners, platformAdmin }, partners }
}

async function pegaErro(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}

describe('revisao de candidatura de Parceiro — NR-115', () => {
  it('quem nao e Super Admin nao lista a fila', async () => {
    const c = cenario()
    const erro = await pegaErro(() => listPendingPartnerApplications(c.deps, NAO_ADMIN_ID))
    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('quem nao e Super Admin nao aprova', async () => {
    const c = cenario()
    await c.partners.submit({
      ownerUserId: 'dono-1',
      ownerCompanyId: 'empresa-1',
      pixKey: '41999990000',
      pixKeyType: 'PHONE',
      message: 'Quero divulgar o Buddy.',
      couponCode: 'JOAO10',
    })

    const erro = await pegaErro(() => approvePartnerApplication(c.deps, NAO_ADMIN_ID, 'partner-1'))
    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('Super Admin lista as candidaturas pendentes', async () => {
    const c = cenario()
    await c.partners.submit({
      ownerUserId: 'dono-1',
      ownerCompanyId: 'empresa-1',
      pixKey: '41999990000',
      pixKeyType: 'PHONE',
      message: 'Quero divulgar o Buddy.',
      couponCode: 'JOAO10',
    })

    const fila = await listPendingPartnerApplications(c.deps, ADMIN_ID)
    expect(fila).toHaveLength(1)
    expect(fila[0]?.couponCode).toBe('JOAO10')
  })

  it('Super Admin aprova uma candidatura', async () => {
    const c = cenario()
    const { partnerId } = await c.partners.submit({
      ownerUserId: 'dono-1',
      ownerCompanyId: 'empresa-1',
      pixKey: '41999990000',
      pixKeyType: 'PHONE',
      message: 'Quero divulgar o Buddy.',
      couponCode: 'JOAO10',
    })

    await approvePartnerApplication(c.deps, ADMIN_ID, partnerId, 'Tudo certo')

    const minha = await c.partners.mine('empresa-1')
    expect(minha?.status).toBe('active')
    expect(minha?.reviewNote).toBe('Tudo certo')
  })

  it('Super Admin recusa uma candidatura', async () => {
    const c = cenario()
    const { partnerId } = await c.partners.submit({
      ownerUserId: 'dono-1',
      ownerCompanyId: 'empresa-1',
      pixKey: '41999990000',
      pixKeyType: 'PHONE',
      message: 'Quero divulgar o Buddy.',
      couponCode: 'JOAO10',
    })

    await rejectPartnerApplication(c.deps, ADMIN_ID, partnerId)

    const minha = await c.partners.mine('empresa-1')
    expect(minha?.status).toBe('rejected')
  })

  describe('aviso por e-mail a quem se candidatou — achado do QA', () => {
    function comAvisos(falhar = false) {
      const c = cenario()
      const enviados: { tipo: string; email: string; extra: string | null }[] = []
      const applicantNotice = {
        recebida: async () => {},
        aprovada: async (i: { email: string; couponCode: string | null }) => {
          if (falhar) throw new Error('smtp fora')
          enviados.push({ tipo: 'aprovada', email: i.email, extra: i.couponCode })
        },
        recusada: async (i: { email: string; note: string | null }) => {
          if (falhar) throw new Error('smtp fora')
          enviados.push({ tipo: 'recusada', email: i.email, extra: i.note })
        },
      }
      return { ...c, deps: { ...c.deps, applicantNotice }, enviados }
    }
    const candidatar = (c: ReturnType<typeof cenario>) =>
      c.partners.submit({
        ownerUserId: 'dono-1',
        ownerCompanyId: 'empresa-1',
        pixKey: '41999990000',
        pixKeyType: 'PHONE',
        message: 'Quero divulgar o Buddy.',
        couponCode: 'JOAO10',
      })

    it('aprovar avisa o e-mail da candidata, com o cupom', async () => {
      const c = comAvisos()
      const { partnerId } = await candidatar(c)
      await approvePartnerApplication(c.deps, ADMIN_ID, partnerId)
      expect(c.enviados).toEqual([
        { tipo: 'aprovada', email: 'teste@empresa.local', extra: 'JOAO10' },
      ])
    })

    it('recusar avisa com o motivo', async () => {
      const c = comAvisos()
      const { partnerId } = await candidatar(c)
      await rejectPartnerApplication(c.deps, ADMIN_ID, partnerId, 'Faltou a chave PIX certa.')
      expect(c.enviados).toEqual([
        { tipo: 'recusada', email: 'teste@empresa.local', extra: 'Faltou a chave PIX certa.' },
      ])
    })

    it('e-mail que falha nao desfaz a decisao', async () => {
      const c = comAvisos(true)
      const { partnerId } = await candidatar(c)
      await approvePartnerApplication(c.deps, ADMIN_ID, partnerId)
      expect(await c.partners.listPending()).toEqual([])
    })
  })
})
