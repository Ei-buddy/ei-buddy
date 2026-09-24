import { describe, expect, it } from 'vitest'
import { changePhone } from './change-phone.js'

const AGORA = new Date('2026-09-24T12:00:00.000Z')
const quem = { userId: 'usr-1', companyId: 'emp-1', now: AGORA }

function cenario(over: { emUso?: boolean; bancoFalha?: boolean; semSubject?: boolean } = {}) {
  const estado = { banco: '41999990000', provedor: '41999990000', trilha: 0 }
  const deps = {
    contacts: {
      contactOf: async () => ({
        email: 'ana@loja.com',
        phone: estado.banco,
        subject: over.semSubject ? null : 'sub-1',
      }),
      changePhone: async (_u: string, phone: string) => {
        if (over.bancoFalha) throw new Error('indice unico')
        estado.banco = phone
      },
    },
    provider: {
      verify: async (c: { identifier: string; secret: string }) =>
        c.secret === 'certa' ? { subject: 'sub-1', email: 'ana@loja.com', phone: null } : undefined,
    },
    phoneChanger: {
      setPhone: async (_s: string, novo: string) => {
        estado.provedor = novo
        return true
      },
    },
    users: {
      findByPhone: async () =>
        over.emUso ? { id: 'outro', name: 'Outro', isActive: true } : undefined,
    },
    audit: { record: async () => void (estado.trilha += 1) as never },
  }
  return { deps: deps as never, estado }
}

describe('trocar o celular — RF-132', () => {
  it('troca no banco e no provedor, e registra na trilha', async () => {
    const c = cenario()
    await changePhone(c.deps, quem, { phone: '41988887777', secret: 'certa' })

    expect(c.estado).toMatchObject({ banco: '41988887777', provedor: '41988887777', trilha: 1 })
  })

  it('senha errada nao troca nada', async () => {
    const c = cenario()
    await expect(
      changePhone(c.deps, quem, { phone: '41988887777', secret: 'errada' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(c.estado.banco).toBe('41999990000')
  })

  it('numero de outra conta e recusado', async () => {
    const c = cenario({ emUso: true })
    await expect(
      changePhone(c.deps, quem, { phone: '41988887777', secret: 'certa' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(c.estado.provedor).toBe('41999990000')
  })

  it('se o banco falhar, o provedor volta ao numero antigo', async () => {
    const c = cenario({ bancoFalha: true })
    await expect(
      changePhone(c.deps, quem, { phone: '41988887777', secret: 'certa' }),
    ).rejects.toThrow()
    expect(c.estado.provedor).toBe('41999990000')
  })

  it('recem-cadastrada, sem subject gravado, usa o que a senha conferiu', async () => {
    const c = cenario({ semSubject: true })
    await changePhone(c.deps, quem, { phone: '41988887777', secret: 'certa' })

    expect(c.estado.provedor).toBe('41988887777')
  })
})
